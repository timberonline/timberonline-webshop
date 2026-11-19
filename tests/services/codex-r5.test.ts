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

describe("Codex ronde 6", () => {
  it("weigert een provider-ID die bij een andere order hoort en laat die order ongemoeid", async () => {
    const a = await paidOrder();
    const b = await paidOrder();
    await t.db.rpc("api_refund_provider_update", { provider_refund_id: "re_ander", payment_intent_id: b.pi, amount_cents: 500, status: "succeeded" });
    const begin = await t.db.rpc<{ refund_id: string }>("api_refund_begin", { actor: ACTOR, order_id: a.id, amount_cents: 500, idempotency_key: `x-${a.id}` });
    await expect(t.db.rpc("api_refund_finish", { refund_id: begin.refund_id, status: "succeeded", provider_refund_id: "re_ander" })).rejects.toThrow(/andere order/);
    const rows = await q<{ order_id: string }>(t.pool, "select order_id from refunds where provider_refund_id = 're_ander'");
    expect(rows).toEqual([{ order_id: b.id }]);
  });

  it("slaat artikelen met gedeelde onderdelen gelijktijdig op zonder deadlock", async () => {
    const skus = ["TO-SP2-IP14-STD", "TO-SP2-IP14PM-STD", "TO-SP2-IP15P-PRV", "TO-SP2-IP15PM-PRV"];
    const ids = await Promise.all(skus.map((s) => productId(t.pool, s)));
    for (const id of ids) await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_title_fix_required: false, bol_offer_id: `o-par-${id.slice(0, 6)}` });
    const bundle = await productId(t.pool, "TO-BND-IP14-CS-SP2");
    const comps = await q<{ component_id: string; qty: number }>(t.pool, "select component_id, qty from product_components where product_id = $1", [bundle]);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 === 0
          ? t.db.rpc("api_product_save", { actor: ACTOR, id: bundle, components: comps })
          : t.db.rpc("api_product_save", { actor: ACTOR, id: ids[i % ids.length], bol_buffer_units: String(i % 3) }),
      ),
    );
    expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
  });
});

describe("Codex ronde 7", () => {
  it("geen deadlock tussen een order en het gelijktijdig opslaan van de samenstelling van hetzelfde artikel", async () => {
    const bundle = await productId(t.pool, "TO-BND-IP14-CS-SP1");
    await t.db.rpc("api_product_save", { actor: ACTOR, id: bundle, status: "active" });
    const comps = await q<{ component_id: string; qty: number }>(t.pool, "select component_id, qty from product_components where product_id = $1", [bundle]);
    for (let round = 0; round < 10; round++) {
      const results = await Promise.allSettled([
        t.db.rpc<{ ok: boolean; order_id?: string }>("api_create_web_order", { lines: [{ product_id: bundle, qty: 1 }] }),
        t.db.rpc("api_product_save", { actor: ACTOR, id: bundle, components: comps }),
        t.db.rpc<{ ok: boolean; order_id?: string }>("api_create_web_order", { lines: [{ product_id: bundle, qty: 1 }] }),
      ]);
      const errors = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
      expect(errors).toEqual([]);
      for (const r of results) {
        const v = (r as PromiseFulfilledResult<{ order_id?: string }>).value;
        if (v?.order_id) await t.db.rpc("api_release_order", { order_id: v.order_id, status: "expired" });
      }
    }
  });
});

describe("lockvolgorde order ↔ artikel opslaan (CI-deadlock, deterministisch)", () => {
  it("laat een opslaande samenstelling eerst op de onderdelen wachten, nooit met een bol_sync-rij in handen", async () => {
    const set = await productId(t.pool, "TO-SP2-IP14-STD"); // deelt onderdeel C-SP-IP14-STD met de bundel
    await t.db.rpc("api_product_save", { actor: ACTOR, id: set, bol_enabled: true, bol_title_fix_required: false, bol_offer_id: "o-det" });
    const bundle = await productId(t.pool, "TO-BND-IP14-CS-SP2");
    const comps = await q<{ component_id: string; qty: number }>(t.pool, "select component_id, qty from product_components where product_id = $1", [bundle]);
    const a = await t.pool.connect();
    try {
      await a.query("begin");
      await a.query("set local lock_timeout = '5s'");
      // A gedraagt zich als het orderpad: eerst de onderdelen vergrendelen
      await a.query("select id from components where id = any($1::uuid[]) order by id for update", [comps.map((c) => c.component_id)]);
      // B slaat de bundel op terwijl A de onderdelen vasthoudt
      const save = t.db.rpc("api_product_save", { actor: ACTOR, id: bundle, components: comps });
      await new Promise((r) => setTimeout(r, 400));
      // A werkt daarna de bol-rij bij (zoals mark_bol_stock_dirty in het orderpad): mag niet op B wachten
      await a.query("update bol_sync set desired_version = desired_version where product_id = $1 and kind = 'stock'", [set]);
      await a.query("commit");
      await expect(save).resolves.toMatchObject({ ok: true });
    } finally {
      a.release();
    }
  });
});

describe("Codex ronde 8: verloopsweeper vergrendelt bol-rijen gesorteerd", () => {
  it("deadlockt niet met een transactie die de bol-rijen in gesorteerde volgorde neemt", async () => {
    const skus = ["TO-SP2-IP11PM-PRV", "TO-SP2-IP12-PRV"];
    const ids = await Promise.all(skus.map((s) => productId(t.pool, s)));
    for (const id of ids) await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: `o-sw-${id.slice(0, 6)}` });
    const [lo, hi] = [...ids].sort();
    // order 1 (oudste) gebruikt het artikel met de 'hoge' bol-rij, order 2 het artikel met de 'lage'
    const o1 = await t.db.rpc<{ order_id: string }>("api_create_web_order", { lines: [{ product_id: hi, qty: 1 }] });
    const o2 = await t.db.rpc<{ order_id: string }>("api_create_web_order", { lines: [{ product_id: lo, qty: 1 }] });
    await t.pool.query("update orders set reserved_until = now() - interval '10 minutes' where id = $1", [o1.order_id]);
    await t.pool.query("update orders set reserved_until = now() - interval '5 minutes' where id = $1", [o2.order_id]);
    const a = await t.pool.connect();
    try {
      await a.query("begin");
      await a.query("set local lock_timeout = '5s'");
      await a.query("update bol_sync set desired_version = desired_version where product_id = $1 and kind = 'stock'", [lo]);
      const sweep = t.db.rpc<{ expired: number }>("api_expire_stale_orders", { limit: 10 });
      await new Promise((r) => setTimeout(r, 400));
      await a.query("update bol_sync set desired_version = desired_version where product_id = $1 and kind = 'stock'", [hi]);
      await a.query("commit");
      await expect(sweep).resolves.toMatchObject({ ok: true });
    } finally {
      a.release();
    }
    const rows = await q<{ payment_status: string }>(t.pool, "select payment_status from orders where id = any($1::uuid[]) order by created_at", [[o1.order_id, o2.order_id]]);
    expect(rows.map((r) => r.payment_status)).toEqual(["expired", "expired"]);
  });
});
