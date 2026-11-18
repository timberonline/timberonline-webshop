import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, productId, q, type TestDb } from "../helpers/db";
import { fakeStripe, testCtx } from "../helpers/ctx";
import { cancelOrder, refundOrder, refundStatus } from "@/server/services/orders";
import { handleStripeEvent } from "@/server/services/stripe-webhook";

/** Terugbetalingen: Stripe "pending" is niet "terugbetaald"; latere provider-updates ronden af; annulering blijft zichtbaar. */
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
  const [o] = await q<{ payment_status: string; refunded_cents: number; needs_attention: boolean; attention_reason: string | null; fulfillment_status: string }>(
    t.pool,
    "select payment_status, refunded_cents, needs_attention, attention_reason, fulfillment_status from orders where id = $1",
    [id],
  );
  return o;
}
function event(type: string, obj: Record<string, unknown>): Stripe.Event {
  return { id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object: obj } } as unknown as Stripe.Event;
}
/** nep-Stripe waarvan refunds.create een gekozen status teruggeeft (of faalt). */
function stripeWith(status: string | Error) {
  const { stripe, state } = fakeStripe();
  (stripe.refunds as unknown as { create: unknown }).create = async (params: { payment_intent: string; amount: number }) => {
    if (status instanceof Error) throw status;
    const r = { id: `re_${Math.random().toString(36).slice(2, 12)}`, payment_intent: params.payment_intent, amount: params.amount, status };
    state.refunds.push(r);
    return r;
  };
  return { stripe, state };
}

beforeAll(async () => {
  t = await freshDb();
  ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
});
afterAll(async () => t.close());

describe("refundstatus", () => {
  it("vertaalt Stripe-statussen", () => {
    expect(refundStatus("succeeded")).toBe("succeeded");
    expect(refundStatus("pending")).toBe("processing");
    expect(refundStatus("requires_action")).toBe("processing");
    expect(refundStatus("failed")).toBe("failed");
    expect(refundStatus("canceled")).toBe("failed");
  });
});

describe("terugbetalen", () => {
  it("boekt een Stripe-refund in behandeling niet als terugbetaald en rondt af via de webhook", async () => {
    const { stripe, state } = stripeWith("pending");
    const { ctx } = testCtx(t.db, { stripe });
    const o = await paidOrder();
    const res = await refundOrder(ctx, ACTOR, o.id, 1995, "test");
    expect(res).toMatchObject({ ok: true, status: "processing" });
    expect(await order(o.id)).toMatchObject({ payment_status: "paid", refunded_cents: 0, needs_attention: true, attention_reason: "Terugbetaling in behandeling bij Stripe" });

    const re = state.refunds[0];
    const ev = event("refund.updated", { ...re, status: "succeeded" });
    await handleStripeEvent(ctx, ev);
    await handleStripeEvent(ctx, ev); // dubbel afgeleverd: geen dubbele boeking
    expect(await order(o.id)).toMatchObject({ payment_status: "refunded", refunded_cents: 1995, needs_attention: false });
    const rows = await q<{ status: string }>(t.pool, "select status from refunds where order_id = $1", [o.id]);
    expect(rows).toEqual([{ status: "succeeded" }]);
  });

  it("markeert een later mislukte refund als aandachtspunt en laat het bedrag opnieuw terugbetaalbaar", async () => {
    const { stripe, state } = stripeWith("pending");
    const { ctx } = testCtx(t.db, { stripe });
    const o = await paidOrder();
    await refundOrder(ctx, ACTOR, o.id, 1995);
    await handleStripeEvent(ctx, event("refund.failed", { ...state.refunds[0], status: "failed", failure_reason: "expired_or_canceled_card" }));
    const after = await order(o.id);
    expect(after).toMatchObject({ payment_status: "paid", refunded_cents: 0, needs_attention: true });
    expect(after.attention_reason).toMatch(/Terugbetaling mislukt: expired_or_canceled_card/);
    // opnieuw proberen (nieuwe sleutel) is toegestaan voor het volle bedrag
    const ok = stripeWith("succeeded");
    const retry = await refundOrder(testCtx(t.db, { stripe: ok.stripe }).ctx, ACTOR, o.id, 1995);
    expect(retry).toMatchObject({ ok: true, status: "succeeded" });
    expect(await order(o.id)).toMatchObject({ payment_status: "refunded", refunded_cents: 1995, needs_attention: false });
  });

  it("houdt een geannuleerde, betaalde order zichtbaar zolang de terugbetaling mislukt", async () => {
    const { stripe } = stripeWith(new Error("Stripe onbereikbaar"));
    const { ctx } = testCtx(t.db, { stripe });
    const o = await paidOrder();
    const res = await cancelOrder(ctx, ACTOR, o.id, true);
    expect(res).toMatchObject({ ok: true, refund: { ok: false } });
    const after = await order(o.id);
    expect(after).toMatchObject({ fulfillment_status: "cancelled", payment_status: "paid", needs_attention: true });
    expect(after.attention_reason).toMatch(/Terugbetaling (mislukt|openstaand)/);
  });

  it("geeft bij annuleren zonder terugbetaling een openstaande-terugbetalingsmelding", async () => {
    const { ctx } = testCtx(t.db, { stripe: stripeWith("succeeded").stripe });
    const o = await paidOrder();
    await cancelOrder(ctx, ACTOR, o.id, false);
    expect((await order(o.id)).attention_reason).toMatch(/Terugbetaling openstaand/);
    await refundOrder(ctx, ACTOR, o.id, 1995, "alsnog");
    expect(await order(o.id)).toMatchObject({ payment_status: "refunded", needs_attention: false });
  });

  it("legt een in het Stripe-dashboard gestarte refund vast met audit, één keer", async () => {
    const { ctx } = testCtx(t.db, { stripe: stripeWith("succeeded").stripe });
    const o = await paidOrder();
    const ext = { id: "re_dashboard_1", object: "refund", payment_intent: o.pi, amount: 500, status: "succeeded" };
    await handleStripeEvent(ctx, event("refund.created", ext));
    await handleStripeEvent(ctx, event("refund.updated", ext));
    expect(await order(o.id)).toMatchObject({ payment_status: "partially_refunded", refunded_cents: 500 });
    const audit = await q<{ n: number }>(t.pool, "select count(*)::int n from audit_log where action = 'refund_external' and entity_id = $1", [o.id]);
    expect(audit[0].n).toBe(1);
  });
});
