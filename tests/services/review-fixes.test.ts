/** Regressietests voor de bevindingen uit Codex-reviewronde 1. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testCtx } from "../helpers/ctx";
import { componentOnHand, freshDb, productId, q, type TestDb } from "../helpers/db";
import { importBolOrder, processOutbox } from "@/server/services/bol-sync";
import { confirmHandover, prepareShipment } from "@/server/services/shipping";
import { sendOrderEmail } from "@/server/services/email";
import { createLiveBol } from "@/server/integrations/bol";
import type { CarrierDriver, LabelRequest } from "@/server/integrations/carriers";
import { createSimulatedCarriers } from "@/server/integrations/carriers";

let t: TestDb;
const ACTOR = "test:admin";
let ip15: string;
let comp15: string;

beforeAll(async () => {
  t = await freshDb();
  ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
  comp15 = (await q<{ id: string }>(t.pool, "select id from components where code = 'C-SP-IP15-PRV'"))[0].id;
  await t.db.rpc("api_product_save", { actor: ACTOR, id: ip15, bol_enabled: true, bol_offer_id: "rf-ip15" });
});
afterAll(async () => t.close());

async function paidWeb(qty = 1) {
  const r = await t.db.rpc<{ order_id: string }>("api_create_web_order", { lines: [{ product_id: ip15, qty }] });
  await t.db.rpc("api_mark_order_paid", {
    order_id: r.order_id,
    payment_intent_id: `pi_${r.order_id.slice(0, 6)}`,
    customer: { email: "k@example.test", name: "K", street: "S", house_number: "1", postal_code: "1234 AB", city: "C", country: "NL" },
  });
  return r.order_id;
}

describe("Codex #1: herimport van een bol-order boekt eerdere regels niet opnieuw af", () => {
  it("[A] en daarna [A, B] boekt alleen B extra af", async () => {
    const { ctx } = testCtx(t.db);
    const base = { bol_order_id: "RF-1", customer: { name: "B", street: "S", house_number: "1", postal_code: "1234 AB", city: "C" } };
    const a = { order_item_id: "rf-a", offer_id: "rf-ip15", qty: 2, unit_price_cents: 1995 };
    const b = { order_item_id: "rf-b", offer_id: "rf-ip15", qty: 1, unit_price_cents: 1995 };
    const before = (await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand;
    await importBolOrder(ctx, { ...base, items: [a] });
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before - 4);
    await importBolOrder(ctx, { ...base, items: [a, b] });
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before - 6);
    const mv = await q<{ delta: number }>(t.pool, "select delta from stock_movements m join orders o on o.id = m.order_id where o.bol_order_id = 'RF-1' order by m.id");
    expect(mv.map((m) => m.delta)).toEqual([-4, -2]);
  });
});

describe("Codex #2: bol-aanbiedingen die een component delen beloven samen nooit meer dan fysiek", () => {
  it("verdeelt vrije stuks evenredig over bol-actieve artikelen met dezelfde component", async () => {
    // hypothetische tweede bol-SKU op dezelfde component (bv. een driepack)
    await t.pool.query(
      `insert into products (sku, slug, kind, product_type, title, status, web_price_cents, bol_price_cents, bol_enabled, bol_offer_id)
       values ('TO-SP3-IP15-PRV', 'test-driepack', 'set', 'privacy', 'Test driepack', 'active', 2495, 2495, true, 'rf-ip15-3')`,
    );
    const [{ id }] = await q<{ id: string }>(t.pool, "select id from products where sku = 'TO-SP3-IP15-PRV'");
    await t.pool.query("insert into product_components (product_id, component_id, qty) values ($1, $2, 3)", [id, comp15]);
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: comp15, mode: "set", value: 10, reason: "test" });
    const [r] = await q<{ a: number; b: number }>(t.pool, "select public.bol_target_stock($1) a, public.bol_target_stock($2) b", [ip15, id]);
    // 10 stuks / 2 artikelen = 5 elk → tweepack: 2 − 1 = 1 (2 stuks); driepack: 1 − 1 = 0
    expect(r.a * 2 + r.b * 3).toBeLessThanOrEqual(10);
    expect(r).toEqual({ a: 1, b: 0 });
    await t.pool.query("update products set bol_enabled = false, status = 'archived' where id = $1", [id]);
    const [r2] = await q<{ a: number }>(t.pool, "select public.bol_target_stock($1) a", [ip15]);
    expect(r2.a).toBe(4); // weer alleen: 5 tweepacks − 1
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: comp15, mode: "set", value: 40, reason: "test" });
  });
});

describe("Codex #3: live bol-verzoeken kunnen de claimtermijn niet overleven", () => {
  it("breekt een hangend verzoek af na de time-out", async () => {
    const fetchImpl = ((url: string, init: RequestInit) =>
      url.startsWith("https://login.bol.com")
        ? Promise.resolve(new Response(JSON.stringify({ access_token: "t", expires_in: 300 })))
        : new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const bol = createLiveBol({ clientId: "a", clientSecret: "b", fetchImpl, timeoutMs: 50 });
    await expect(bol.updateStock({ offerId: "x", reference: null, ean: null }, 1)).rejects.toThrow();
  });
});

describe("Codex #4: verzendmail wordt in dezelfde transactie als de overdracht klaargezet", () => {
  it("een crash na de overdracht laat een te versturen mail achter die de herpoging oppakt", async () => {
    const orderId = await paidWeb();
    const prep = await t.db.rpc<{ shipment_id: string }>("api_shipment_prepare", { actor: ACTOR, order_id: orderId });
    const c = await t.db.rpc<{ token: string }>("api_label_claim", { shipment_id: prep.shipment_id });
    await t.db.rpc("api_label_complete", { shipment_id: prep.shipment_id, token: c.token, ok: true, label_path: "x.pdf", label_source: "simulated", tracking_code: "SIM1" });
    // alleen de databasestap, geen sendOrderEmail (simuleert procesuitval)
    await t.db.rpc("api_shipment_handover", { actor: ACTOR, shipment_id: prep.shipment_id });
    const pending = await t.db.rpc<{ order_id: string; kind: string }[]>("api_email_retry_list", {});
    expect(pending).toEqual(expect.arrayContaining([{ order_id: orderId, kind: "shipped" }, { order_id: orderId, kind: "order_confirmation" }]));
    const { ctx, sink } = testCtx(t.db);
    for (const m of pending.filter((x) => x.order_id === orderId)) await sendOrderEmail(ctx, m.order_id, m.kind as "shipped");
    for (const m of pending.filter((x) => x.order_id === orderId)) await sendOrderEmail(ctx, m.order_id, m.kind as "shipped");
    expect(sink).toHaveLength(2);
    // een op 'sending' blijven hangende mail wordt na 5 minuten opnieuw opgepakt
    await t.pool.query("update email_log set status = 'sending', updated_at = now() - interval '10 minutes' where order_id = $1 and kind = 'shipped'", [orderId]);
    await t.pool.query("alter table email_log disable trigger email_log_touch");
    await t.pool.query("update email_log set updated_at = now() - interval '10 minutes' where order_id = $1 and kind = 'shipped'", [orderId]);
    await t.pool.query("alter table email_log enable trigger email_log_touch");
    const again = await t.db.rpc<{ order_id: string }[]>("api_email_retry_list", {});
    expect(again.map((x) => x.order_id)).toContain(orderId);
  });
});

describe("Codex #5: bol-verzendbevestiging is pas klaar na geslaagde processtatus", () => {
  it("houdt 'ingediend' vast, controleert de processtatus en probeert opnieuw bij afwijzing", async () => {
    const { ctx, bol } = testCtx(t.db);
    const r = await importBolOrder(ctx, { bol_order_id: "RF-5", customer: { name: "B", street: "S", house_number: "1", postal_code: "1234 AB", city: "C" }, items: [{ order_item_id: "rf5", offer_id: "rf-ip15", qty: 1, unit_price_cents: 1995 }] });
    const s = (await prepareShipment(ctx, ACTOR, r.order_id)) as { shipment_id: string };
    let procStatus: "pending" | "failed" | "done" = "pending";
    let confirms = 0;
    bol.confirmShipment = async () => {
      confirms++;
      return { status: "submitted", processId: `p${confirms}` };
    };
    bol.checkProcess = async () => (procStatus === "failed" ? { status: "failed", error: "bol wees af" } : procStatus === "done" ? { status: "done" } : { status: "pending" });
    await confirmHandover(ctx, ACTOR, s.shipment_id);
    const row = async () => (await q<{ status: string; attempts: number }>(t.pool, "select status, attempts from outbox where payload->>'order_id' = $1", [r.order_id]))[0];
    expect(await row()).toEqual({ status: "submitted", attempts: 0 });
    const due = () => t.pool.query("update outbox set next_attempt_at = now() where payload->>'order_id' = $1", [r.order_id]);
    await due();
    await processOutbox(ctx);
    expect((await row()).status).toBe("submitted"); // nog in behandeling
    procStatus = "failed";
    await due();
    await processOutbox(ctx);
    expect(await row()).toEqual({ status: "pending", attempts: 1 });
    procStatus = "done";
    await due();
    await processOutbox(ctx); // opnieuw indienen
    await due();
    await processOutbox(ctx); // processtatus geslaagd
    expect((await row()).status).toBe("done");
    expect(confirms).toBe(2);
  });
});

describe("Codex #6: vervoerder krijgt een stabiele idempotentiesleutel per zending", () => {
  it("geeft dezelfde sleutel mee bij een herhaalde labelaanvraag na een fout", async () => {
    const keys: string[] = [];
    const sim = createSimulatedCarriers();
    let fail = true;
    const carriers: CarrierDriver = {
      mode: "simulated",
      async createLabel(req: LabelRequest) {
        keys.push(req.idempotencyKey);
        if (fail) {
          fail = false;
          throw new Error("time-out");
        }
        return sim.createLabel(req);
      },
    };
    const { ctx } = testCtx(t.db);
    ctx.carriers = carriers;
    const orderId = await paidWeb();
    const first = (await prepareShipment(ctx, ACTOR, orderId)) as { shipment_id: string; label: { ok: boolean } };
    expect(first.label.ok).toBe(false);
    const second = (await prepareShipment(ctx, ACTOR, orderId)) as { label: { ok: boolean } };
    expect(second.label.ok).toBe(true);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("Codex #7: betaling na annulering", () => {
  it("boekt geen voorraad af en markeert de order voor terugbetaling", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await t.db.rpc<{ order_id: string }>("api_create_web_order", { lines: [{ product_id: ip15, qty: 1 }] });
    await t.db.rpc("api_order_cancel", { actor: ACTOR, order_id: r.order_id });
    const paid = await t.db.rpc<{ refund_required: boolean; stock_status: string }>("api_mark_order_paid", { order_id: r.order_id, payment_intent_id: "pi_rf7" });
    expect(paid.refund_required).toBe(true);
    const [o] = await q<{ payment_status: string; fulfillment_status: string; stock_status: string; attention_reason: string }>(
      t.pool,
      "select payment_status, fulfillment_status, stock_status, attention_reason from orders where id = $1",
      [r.order_id],
    );
    expect(o).toMatchObject({ payment_status: "paid", fulfillment_status: "cancelled", stock_status: "released" });
    expect(o.attention_reason).toMatch(/terugbetalen/);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand);
    const mails = await q(t.pool, "select 1 from email_log where order_id = $1", [r.order_id]);
    expect(mails).toHaveLength(0);
  });
});
