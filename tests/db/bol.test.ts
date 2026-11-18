import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentOnHand, freshDb, productId, q, type TestDb } from "../helpers/db";

let t: TestDb;
const ACTOR = "test:admin";
let ip12pm: string; // privacy iPhone 12 Pro Max: 5 stuks
let ip15: string; // privacy iPhone 15: 45 stuks
let compIp12pm: string;

type Claim = { items: { product_id: string; kind: string; action: string; token: string; value: number; version: number }[] };

async function target(id: string) {
  const [r] = await q<{ v: number }>(t.pool, "select public.bol_target_stock($1) v", [id]);
  return r.v;
}
async function syncRow(id: string, kind = "stock") {
  const [r] = await q<{ status: string; desired_value: number; pushed_value: number | null; attempts: number; last_error: string | null }>(
    t.pool,
    "select status, desired_value, pushed_value, attempts, last_error from bol_sync where product_id = $1 and kind = $2",
    [id, kind],
  );
  return r;
}
async function makeDue() {
  await t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second'");
}

beforeAll(async () => {
  t = await freshDb();
  ip12pm = await productId(t.pool, "TO-SP2-IP12PM-PRV");
  ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
  compIp12pm = (await q<{ id: string }>(t.pool, "select id from components where code = 'C-SP-IP12PM-PRV'"))[0].id;
  for (const id of [ip12pm, ip15]) {
    await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: `offer-${id.slice(0, 6)}` });
  }
});
afterAll(async () => t.close());

describe("bol-voorraadberekening", () => {
  it("houdt een buffer van één verkoopbare eenheid aan voor de webshop", async () => {
    // 5 vrije protectors = 2 tweepacks; min buffer 1 → bol biedt 1 tweepack aan
    expect((await componentOnHand(t.pool, "C-SP-IP12PM-PRV")).free).toBe(5);
    expect(await target(ip12pm)).toBe(1);
  });

  it("zet het bol-aanbod op nul bij twee vrije protectors", async () => {
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 2, reason: "test" });
    expect(await target(ip12pm)).toBe(0);
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 5, reason: "test" });
  });

  it("trekt open reserveringen af", async () => {
    const r = await t.db.rpc<{ ok: boolean; order_id: string }>("api_create_web_order", { lines: [{ product_id: ip12pm, qty: 1 }] });
    expect(r.ok).toBe(true);
    expect(await target(ip12pm)).toBe(0); // 3 vrij → 1 eenheid − buffer
    await t.db.rpc("api_release_order", { order_id: r.order_id, status: "expired" });
    expect(await target(ip12pm)).toBe(1);
  });

  it("gebruikt een instelbare buffer per SKU en globaal", async () => {
    await t.db.rpc("api_product_save", { actor: ACTOR, id: ip15, bol_buffer_units: "3" });
    expect(await target(ip15)).toBe(22 - 3);
    await t.db.rpc("api_product_save", { actor: ACTOR, id: ip15, bol_buffer_units: "" });
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "bol_buffer_units", value: 2 });
    expect(await target(ip15)).toBe(22 - 2);
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "bol_buffer_units", value: 1 });
  });
});

describe("bol-synchronisatie", () => {
  it("zet relevante voorraadmutaties in de wachtrij en pusht altijd de nieuwste stand", async () => {
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 9, reason: "levering" });
    await makeDue();
    const claim = await t.db.rpc<Claim>("api_bol_sync_claim", { limit: 50 });
    const item = claim.items.find((i) => i.product_id === ip12pm && i.kind === "stock")!;
    expect(item.value).toBe(3); // 9 stuks = 4 tweepacks − 1
    // nieuwere mutatie terwijl de update onderweg is
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 11, reason: "nog een doos" });
    expect((await syncRow(ip12pm)).status).toBe("in_flight");
    await t.db.rpc("api_bol_sync_complete", { product_id: ip12pm, kind: "stock", token: item.token, result: "done" });
    const row = await syncRow(ip12pm);
    expect(row.pushed_value).toBe(3);
    expect(row.status).toBe("pending"); // nieuwere stand moet nog verstuurd worden
    const claim2 = await t.db.rpc<Claim>("api_bol_sync_claim", { limit: 50 });
    const item2 = claim2.items.find((i) => i.product_id === ip12pm && i.kind === "stock")!;
    expect(item2.value).toBe(4);
    await t.db.rpc("api_bol_sync_complete", { product_id: ip12pm, kind: "stock", token: item2.token, result: "done" });
    expect(await syncRow(ip12pm)).toMatchObject({ status: "synced", pushed_value: 4 });
  });

  it("laat een verouderde (overgenomen) update de nieuwere stand niet overschrijven", async () => {
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 7, reason: "telling" });
    await makeDue();
    const old = (await t.db.rpc<Claim>("api_bol_sync_claim", {})).items.find((i) => i.product_id === ip12pm)!;
    // worker hangt; na de claimtimeout neemt een nieuwe worker het over
    await t.pool.query("update bol_sync set claimed_at = now() - interval '5 minutes' where product_id = $1 and kind = 'stock'", [ip12pm]);
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 3, reason: "beschadigd" });
    const fresh = (await t.db.rpc<Claim>("api_bol_sync_claim", {})).items.find((i) => i.product_id === ip12pm)!;
    expect(fresh.value).toBe(0);
    await t.db.rpc("api_bol_sync_complete", { product_id: ip12pm, kind: "stock", token: fresh.token, result: "done" });
    const late = await t.db.rpc<{ ok: boolean; stale: boolean }>("api_bol_sync_complete", { product_id: ip12pm, kind: "stock", token: old.token, result: "done" });
    expect(late.stale).toBe(true);
    expect(await syncRow(ip12pm)).toMatchObject({ status: "synced", pushed_value: 0 });
  });

  it("probeert mislukte updates opnieuw met oplopende wachttijd en toont ze na vijf pogingen als mislukt", async () => {
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 5, reason: "telling" });
    for (let i = 1; i <= 5; i++) {
      await makeDue();
      const it = (await t.db.rpc<Claim>("api_bol_sync_claim", {})).items.find((x) => x.product_id === ip12pm && x.kind === "stock")!;
      await t.db.rpc("api_bol_sync_complete", { product_id: ip12pm, kind: "stock", token: it.token, result: "error", error: "HTTP 503" });
      const row = await syncRow(ip12pm);
      expect(row.attempts).toBe(i);
      expect(row.status).toBe(i < 5 ? "pending" : "failed");
    }
    const overview = await t.db.rpc<{ bol_failed: number }>("api_admin_overview", {});
    expect(overview.bol_failed).toBeGreaterThanOrEqual(1);
    await t.db.rpc("api_bol_sync_retry", { actor: ACTOR, product_id: ip12pm, kind: "stock" });
    expect(await syncRow(ip12pm)).toMatchObject({ status: "pending", attempts: 0 });
    const it = (await t.db.rpc<Claim>("api_bol_sync_claim", {})).items.find((x) => x.product_id === ip12pm && x.kind === "stock")!;
    await t.db.rpc("api_bol_sync_complete", { product_id: ip12pm, kind: "stock", token: it.token, result: "done" });
    expect((await syncRow(ip12pm)).status).toBe("synced");
  });

  it("controleert verschillen met bol en zet ze opnieuw in de wachtrij", async () => {
    const res = await t.db.rpc<{ differences: number }>("api_bol_record_remote", { items: [{ product_id: ip12pm, kind: "stock", remote_value: 7 }] });
    expect(res.differences).toBe(1);
    expect((await syncRow(ip12pm)).status).toBe("pending");
  });

  it("zet een bol-prijswijziging in de wachtrij zonder de voorraad te raken", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    // eerdere claims in deze testreeks zijn niet afgerond; zet de prijsrij terug naar gesynchroniseerd
    await t.pool.query("update bol_sync set status = 'synced', claim_token = null where product_id = $1", [ip15]);
    await t.db.rpc("api_set_price", { actor: ACTOR, product_id: ip15, channel: "bol", price_cents: 1895 });
    expect(await syncRow(ip15, "price")).toMatchObject({ status: "pending", desired_value: 1895 });
    expect(await componentOnHand(t.pool, "C-SP-IP15-PRV")).toEqual(before);
  });
});

describe("bol-orders", () => {
  const order = (items: { id: string; qty: number }[], id = "BOL-1001") => ({
    bol_order_id: id,
    customer: { name: "Bol Klant", street: "Bolstraat", house_number: "5", postal_code: "3511 AB", city: "Utrecht", country: "NL" },
    items: items.map((i) => ({ order_item_id: i.id, offer_id: `offer-${ip15.slice(0, 6)}`, ean: "9509834126616", qty: i.qty, unit_price_cents: 1995 })),
  });

  it("verwerkt iedere bol-orderregel precies één keer, ook gelijktijdig", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const payload = order([{ id: "item-1", qty: 2 }]);
    const results = await Promise.all([
      t.db.rpc<{ new_lines: number; duplicate_lines: number }>("api_bol_import_order", payload),
      t.db.rpc<{ new_lines: number; duplicate_lines: number }>("api_bol_import_order", payload),
      t.db.rpc<{ new_lines: number; duplicate_lines: number }>("api_bol_import_order", payload),
    ]);
    expect(results.reduce((s, r) => s + r.new_lines, 0)).toBe(1);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand - 4);
    const [o] = await q<{ payment_status: string; stock_status: string; channel: string }>(
      t.pool,
      "select payment_status, stock_status, channel from orders where bol_order_id = 'BOL-1001'",
    );
    expect(o).toEqual({ payment_status: "paid", stock_status: "committed", channel: "bol" });
  });

  it("verwerkt een later toegevoegde regel van dezelfde order los", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await t.db.rpc<{ new_lines: number; duplicate_lines: number }>(
      "api_bol_import_order",
      order([
        { id: "item-1", qty: 2 },
        { id: "item-2", qty: 1 },
      ]),
    );
    expect(r).toMatchObject({ new_lines: 1, duplicate_lines: 1 });
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand - 2);
  });

  it("markeert regels zonder gekoppeld artikel", async () => {
    const r = await t.db.rpc<{ unmatched: unknown[] }>("api_bol_import_order", {
      bol_order_id: "BOL-1002",
      items: [{ order_item_id: "x-1", offer_id: "onbekend", ean: "0000000000000", qty: 1, unit_price_cents: 1995 }],
    });
    expect(r.unmatched).toHaveLength(1);
    const [o] = await q<{ needs_attention: boolean }>(t.pool, "select needs_attention from orders where bol_order_id = 'BOL-1002'");
    expect(o.needs_attention).toBe(true);
  });

  it("deelt de fysieke voorraad tussen bol en webshop bij gelijktijdige orders", async () => {
    // zet iPhone 12 Pro Max privacy op 4 stuks = 2 tweepacks
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: compIp12pm, mode: "set", value: 4, reason: "test" });
    const bolPayload = (n: number) => ({
      bol_order_id: `BOL-RACE-${n}`,
      items: [{ order_item_id: `race-${n}`, offer_id: `offer-${ip12pm.slice(0, 6)}`, qty: 1, unit_price_cents: 1995 }],
    });
    const results = await Promise.all([
      t.db.rpc<{ ok: boolean }>("api_create_web_order", { lines: [{ product_id: ip12pm, qty: 1 }] }),
      t.db.rpc<{ ok: boolean }>("api_create_web_order", { lines: [{ product_id: ip12pm, qty: 1 }] }),
      t.db.rpc<{ stock_status: string }>("api_bol_import_order", bolPayload(1)),
      t.db.rpc<{ stock_status: string }>("api_bol_import_order", bolPayload(2)),
    ]);
    const stock = await componentOnHand(t.pool, "C-SP-IP12PM-PRV");
    expect(stock.on_hand).toBeGreaterThanOrEqual(0);
    expect(stock.free).toBeGreaterThanOrEqual(0);
    // fysiek 4 stuks: elke verkoop/reservering ter waarde van 2 stuks die doorging telt mee; tekorten worden gemarkeerd
    const web = results.slice(0, 2) as { ok: boolean }[];
    const bol = results.slice(2) as { stock_status: string }[];
    const sold = web.filter((r) => r.ok).length + bol.filter((r) => r.stock_status === "committed").length;
    expect(sold).toBe(2);
    expect(bol.filter((r) => r.stock_status === "shortage").length + web.filter((r) => !r.ok).length).toBe(2);
  });
});
