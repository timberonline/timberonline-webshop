import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, productId, q, type TestDb } from "../helpers/db";

/** Bevindingen Codex-herreview ronde 5 (commit 9b3e091). */
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

beforeAll(async () => {
  t = await freshDb();
  ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
});
afterAll(async () => t.close());

describe("lockvolgorde refunds (hoog)", () => {
  it("verwerkt afronding en (herhaalde) webhooks voor dezelfde refund gelijktijdig zonder deadlock of dubbele boeking", async () => {
    for (let round = 0; round < 8; round++) {
      const o = await paidOrder();
      const begin = await t.db.rpc<{ refund_id: string }>("api_refund_begin", { actor: ACTOR, order_id: o.id, amount_cents: 1995, idempotency_key: `race-${round}-${o.id}` });
      const provider = `re_conc_${round}_${o.id.slice(0, 6)}`;
      // vroege webhook zonder metadata heeft al een "externe" rij gemaakt
      await t.db.rpc("api_refund_provider_update", { provider_refund_id: provider, payment_intent_id: o.pi, amount_cents: 1995, status: "succeeded" });
      const results = await Promise.allSettled([
        t.db.rpc("api_refund_finish", { refund_id: begin.refund_id, status: "succeeded", provider_refund_id: provider }),
        t.db.rpc("api_refund_provider_update", { provider_refund_id: provider, payment_intent_id: o.pi, amount_cents: 1995, status: "succeeded" }),
        t.db.rpc("api_refund_provider_update", { provider_refund_id: provider, payment_intent_id: o.pi, amount_cents: 1995, status: "succeeded", metadata_refund_id: begin.refund_id }),
      ]);
      const errors = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
      expect(errors).toEqual([]);
      const rows = await q<{ status: string }>(t.pool, "select status from refunds where order_id = $1", [o.id]);
      expect(rows).toEqual([{ status: "succeeded" }]);
      const [ord] = await q<{ refunded_cents: number; payment_status: string }>(t.pool, "select refunded_cents, payment_status from orders where id = $1", [o.id]);
      expect(ord).toEqual({ refunded_cents: 1995, payment_status: "refunded" });
    }
  });
});

describe("samenstellingstrigger (middel)", () => {
  it("plant het artikel zelf opnieuw in als een onderdeel wordt verwijderd of vervangen", async () => {
    const id = await productId(t.pool, "TO-SP2-IP11PM-STD");
    await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: "o-trig" });
    const reset = () => t.pool.query("update bol_sync set status = 'synced', desired_version = 0 where product_id = $1 and kind = 'stock'", [id]);
    const row = async () => (await q<{ status: string; desired_version: string }>(t.pool, "select status, desired_version from bol_sync where product_id = $1 and kind = 'stock'", [id]))[0];

    await reset();
    const other = (await q<{ id: string }>(t.pool, "select id from components where code = 'C-SP-IP12-STD'"))[0].id;
    await t.pool.query("update product_components set component_id = $2 where product_id = $1", [id, other]);
    expect((await row()).status).toBe("pending");

    await reset();
    await t.pool.query("delete from product_components where product_id = $1", [id]);
    const r = await row();
    expect(r.status).toBe("pending");
    expect(Number(r.desired_version)).toBeGreaterThan(0);
  });
});

describe("aandachtsmelding met '·' in fouttekst (laag)", () => {
  it("laat geen restfragment achter", async () => {
    const o = await paidOrder();
    await t.pool.query("update orders set needs_attention = true, attention_reason = 'Andere melding' where id = $1", [o.id]);
    await t.pool.query("select public.set_refund_attention($1, 'Terugbetaling mislukt: kaart · verlopen')", [o.id]);
    await t.pool.query("select public.set_refund_attention($1, null)", [o.id]);
    const [r] = await q<{ attention_reason: string }>(t.pool, "select attention_reason from orders where id = $1", [o.id]);
    expect(r.attention_reason).toBe("Andere melding");
  });
});

describe("teruggevonden bol-aanbod (laag)", () => {
  it("gaat terug naar synced als de stand bij bol al klopt", async () => {
    const id = await productId(t.pool, "TO-SP2-IP12PM-PRV");
    await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: "o-terug2" });
    const [{ v }] = await q<{ v: number }>(t.pool, "select public.bol_target_stock($1) v", [id]);
    await t.db.rpc("api_bol_record_remote", { items: [{ product_id: id, kind: "stock", missing: true }] });
    await t.db.rpc("api_bol_record_remote", { items: [{ product_id: id, kind: "stock", remote_value: v }] });
    const [r] = await q<{ status: string; last_error: string | null }>(t.pool, "select status, last_error from bol_sync where product_id = $1 and kind = 'stock'", [id]);
    expect(r).toEqual({ status: "synced", last_error: null });
  });
});
