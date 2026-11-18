import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, productId, q, type TestDb } from "../helpers/db";
import { fakeStripe, testCtx } from "../helpers/ctx";
import { refundOrder } from "@/server/services/orders";
import { handleStripeEvent } from "@/server/services/stripe-webhook";
import { processBolQueue } from "@/server/services/bol-sync";
import { createSharedRateLimiter } from "@/server/services/contact";

/** Bevindingen Codex-review ronde 4 (commit 67840cc), elk als reproductie. */
let t: TestDb;
const ACTOR = "test:admin";
let ip15: string;

async function paidOrder() {
  const r = await t.db.rpc<{ ok: boolean; order_id: string }>("api_create_web_order", { lines: [{ product_id: ip15, qty: 1 }] });
  const pi = `pi_${r.order_id.replace(/-/g, "").slice(0, 12)}`;
  await t.db.rpc("api_mark_order_paid", {
    order_id: r.order_id,
    payment_intent_id: pi,
    customer: { email: "klant@example.test", name: "Test Klant", street: "Teststraat", house_number: "1", postal_code: "1234 AB", city: "Teststad", country: "NL" },
  });
  return { id: r.order_id, pi };
}
async function order(id: string) {
  const [o] = await q<{ payment_status: string; refunded_cents: number; needs_attention: boolean; attention_reason: string | null }>(
    t.pool,
    "select payment_status, refunded_cents, needs_attention, attention_reason from orders where id = $1",
    [id],
  );
  return o;
}
const event = (type: string, obj: Record<string, unknown>) =>
  ({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object: obj } }) as unknown as Stripe.Event;

/** Stripe waarvan de refund-webhook al binnenkomt terwijl refunds.create nog loopt. */
function racingStripe(opts: { status: string; webhookStatus: string; withMetadata: boolean }) {
  const { stripe } = fakeStripe();
  const { ctx } = testCtx(t.db, { stripe });
  (stripe.refunds as unknown as { create: unknown }).create = async (params: { payment_intent: string; amount: number; metadata?: Record<string, string> }) => {
    const r = { id: `re_race_${Math.random().toString(36).slice(2, 10)}`, object: "refund", payment_intent: params.payment_intent, amount: params.amount };
    await handleStripeEvent(ctx, event("refund.created", { ...r, status: opts.webhookStatus, metadata: opts.withMetadata ? params.metadata : {} }));
    return { ...r, status: opts.status };
  };
  return ctx;
}

beforeAll(async () => {
  t = await freshDb();
  ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
});
afterAll(async () => t.close());

describe("refund-race (hoog)", () => {
  it("koppelt een vroege webhook via metadata aan de eigen refund: één rij, één boeking", async () => {
    const o = await paidOrder();
    const ctx = racingStripe({ status: "succeeded", webhookStatus: "succeeded", withMetadata: true });
    const res = await refundOrder(ctx, ACTOR, o.id, 1995);
    expect(res).toMatchObject({ ok: true, status: "succeeded" });
    const rows = await q<{ status: string; idempotency_key: string }>(t.pool, "select status, idempotency_key from refunds where order_id = $1", [o.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].idempotency_key.startsWith("ext:")).toBe(false);
    expect(await order(o.id)).toMatchObject({ payment_status: "refunded", refunded_cents: 1995, needs_attention: false });
  });

  it("voegt een vroege 'externe' rij zonder metadata samen met de eigen refund", async () => {
    const o = await paidOrder();
    const ctx = racingStripe({ status: "succeeded", webhookStatus: "succeeded", withMetadata: false });
    const res = await refundOrder(ctx, ACTOR, o.id, 1995);
    expect(res).toMatchObject({ ok: true });
    const rows = await q<{ status: string }>(t.pool, "select status from refunds where order_id = $1", [o.id]);
    expect(rows).toEqual([{ status: "succeeded" }]);
    expect(await order(o.id)).toMatchObject({ payment_status: "refunded", refunded_cents: 1995 });
    const dedup = await q<{ n: number }>(t.pool, "select count(*)::int n from audit_log where action = 'refund_deduplicated' and entity_id = $1", [o.id]);
    expect(dedup[0].n).toBe(1);
  });
});

describe("betaalstatus na teruggedraaide refund (hoog)", () => {
  it("zet de status terug naar betaald als een geslaagde refund later mislukt", async () => {
    const o = await paidOrder();
    const { stripe, state } = fakeStripe();
    const { ctx } = testCtx(t.db, { stripe });
    await refundOrder(ctx, ACTOR, o.id, 1995);
    expect((await order(o.id)).payment_status).toBe("refunded");
    await handleStripeEvent(ctx, event("refund.failed", { ...state.refunds[0], object: "refund", status: "failed", failure_reason: "lost_or_stolen_card" }));
    const after = await order(o.id);
    expect(after).toMatchObject({ payment_status: "paid", refunded_cents: 0, needs_attention: true });
    expect(after.attention_reason).toMatch(/mislukt na verwerking/);
  });
});

describe("aandachtsmeldingen (middel)", () => {
  it("vervangt en verwijdert alleen het refundsegment naast een andere melding", async () => {
    const o = await paidOrder();
    await t.pool.query("update orders set needs_attention = true, attention_reason = 'Betaald bedrag wijkt af van ordertotaal' where id = $1", [o.id]);
    await t.pool.query("select public.set_refund_attention($1, 'Terugbetaling in behandeling bij Stripe')", [o.id]);
    expect((await order(o.id)).attention_reason).toBe("Betaald bedrag wijkt af van ordertotaal · Terugbetaling in behandeling bij Stripe");
    await t.pool.query("select public.set_refund_attention($1, 'Terugbetaling mislukt: x')", [o.id]);
    expect((await order(o.id)).attention_reason).toBe("Betaald bedrag wijkt af van ordertotaal · Terugbetaling mislukt: x");
    await t.pool.query("select public.set_refund_attention($1, null)", [o.id]);
    expect(await order(o.id)).toMatchObject({ needs_attention: true, attention_reason: "Betaald bedrag wijkt af van ordertotaal" });
  });
});

describe("webhook-retourwaarde (middel)", () => {
  it("laat een webhook voor een onbekende betaling falen zodat Stripe opnieuw probeert", async () => {
    const { ctx } = testCtx(t.db);
    const ev = event("refund.updated", { id: "re_onbekend", object: "refund", payment_intent: "pi_bestaat_niet", amount: 100, status: "succeeded" });
    await expect(handleStripeEvent(ctx, ev)).rejects.toThrow(/niet verwerkt/);
    const [w] = await q<{ status: string }>(t.pool, "select status from webhook_events where id = $1", [ev.id]);
    expect(w.status).toBe("failed");
  });
});

describe("bol (middel)", () => {
  it("behandelt een door bol afgewezen proces als definitief", async () => {
    const id = await productId(t.pool, "TO-SP2-IP14PM-PRV");
    await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: "o-proc" });
    const { ctx, bol } = testCtx(t.db);
    bol.faults.submitted = true;
    await t.pool.query("update bol_sync set next_attempt_at = now() + interval '1 hour'");
    await t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second' where product_id = $1 and kind = 'stock'", [id]);
    await processBolQueue(ctx, { limit: 1 }); // ingediend met proces-ID
    ctx.bol.checkProcess = async () => ({ status: "failed", error: "Invalid offer", permanent: true });
    await t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second' where product_id = $1 and kind = 'stock'", [id]);
    await processBolQueue(ctx, { limit: 1 });
    const [r] = await q<{ status: string; last_error: string }>(t.pool, "select status, last_error from bol_sync where product_id = $1 and kind = 'stock'", [id]);
    expect(r.status).toBe("failed");
    expect(r.last_error).toMatch(/Definitieve fout.*Invalid offer/);
  });

  it("wist 'aanbod niet gevonden' zodra het aanbod weer leesbaar is en plant een afwijking opnieuw in", async () => {
    const id = await productId(t.pool, "TO-SP2-IP11PM-STD");
    await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: "o-terug" });
    await t.db.rpc("api_bol_record_remote", { items: [{ product_id: id, kind: "stock", missing: true }] });
    await t.db.rpc("api_bol_record_remote", { items: [{ product_id: id, kind: "stock", remote_value: 99 }] });
    const [r] = await q<{ status: string; last_error: string | null }>(t.pool, "select status, last_error from bol_sync where product_id = $1 and kind = 'stock'", [id]);
    expect(r).toEqual({ status: "pending", last_error: null });
  });

  it("plant bol-voorraad opnieuw in na een wijziging van de samenstelling", async () => {
    const id = await productId(t.pool, "TO-SP2-IP12PM-STD");
    await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: "o-samen" });
    await t.pool.query("update bol_sync set status = 'synced', desired_version = 0 where product_id = $1 and kind = 'stock'", [id]);
    await t.pool.query("update product_components set qty = 2 where product_id = $1", [id]);
    const [r] = await q<{ status: string; desired_version: string }>(t.pool, "select status, desired_version from bol_sync where product_id = $1 and kind = 'stock'", [id]);
    expect(r.status).toBe("pending");
    expect(Number(r.desired_version)).toBeGreaterThan(0);
  });
});

describe("verzending (middel)", () => {
  it("geeft een bol-order zonder trackingvlag geen briefpost als de bol-trackingplicht aan staat", async () => {
    const id = await productId(t.pool, "TO-SP2-IP14PM-STD");
    await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: "o-brief" });
    const imp = await t.db.rpc<{ order_id: string }>("api_bol_import_order", {
      bol_order_id: "BOL-NOFLAG-1",
      items: [{ order_item_id: "noflag-1", offer_id: "o-brief", qty: 1, unit_price_cents: 1995 }],
      customer: { name: "Bol Klant", street: "Bolstraat", house_number: "2", postal_code: "1234 AB", city: "Utrecht", country: "NL" },
    });
    await t.pool.query("update orders set tracking_promised = false where id = $1", [imp.order_id]);
    const prep = await t.db.rpc<{ ok: boolean; error?: string; allowed: string[] }>("api_shipment_prepare", { actor: ACTOR, order_id: imp.order_id, carrier: "letter" });
    expect(prep.error).toBe("carrier_not_allowed");
    expect(prep.allowed).not.toContain("letter");
  });
});

describe("gedeelde rate limit (middel)", () => {
  it("telt over instanties heen en slaat geen IP-adres op", async () => {
    const a = createSharedRateLimiter(t.db, { limit: 2, windowSeconds: 3600, scope: "test" });
    const b = createSharedRateLimiter(t.db, { limit: 2, windowSeconds: 3600, scope: "test" });
    expect(await a.take("203.0.113.9")).toBe(true);
    expect(await b.take("203.0.113.9")).toBe(true);
    expect(await a.take("203.0.113.9")).toBe(false);
    expect(await b.take("198.51.100.1")).toBe(true);
    const keys = await q<{ key: string }>(t.pool, "select key from rate_limits");
    expect(keys.every((k) => !k.key.includes("203.0.113.9"))).toBe(true);
  });
});
