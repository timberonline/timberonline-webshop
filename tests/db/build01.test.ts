import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentOnHand, freshDb, productId, q, type TestDb } from "../helpers/db";

/** Aanvullingen TO-BUILD-01 (ronde na de eisencontrole van 18-11-2026). */
let t: TestDb;
const ACTOR = "test:admin";

type Claim = { items: { product_id: string; kind: string; action: string; token: string; value: number }[] };
type Prep = { ok: boolean; shipment_id: string; carrier: string; error?: string; allowed: string[]; notes: string[]; weight_g: number };

async function target(id: string) {
  const [r] = await q<{ v: number }>(t.pool, "select public.bol_target_stock($1) v", [id]);
  return r.v;
}
async function syncRow(id: string, kind = "stock") {
  const [r] = await q<{ status: string; pushed_value: number | null; last_error: string | null; attempts: number }>(
    t.pool,
    "select status, pushed_value, last_error, attempts from bol_sync where product_id = $1 and kind = $2",
    [id, kind],
  );
  return r;
}
async function makeDue() {
  await t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second'");
}
async function claimFor(id: string, kind = "stock") {
  await makeDue();
  const c = await t.db.rpc<Claim>("api_bol_sync_claim", { limit: 50 });
  return c.items.find((i) => i.product_id === id && i.kind === kind)!;
}
async function componentId(code: string) {
  return (await q<{ id: string }>(t.pool, "select id from components where code = $1", [code]))[0].id;
}
async function paidWebOrder(lines: [string, number][]) {
  const r = await t.db.rpc<{ ok: boolean; order_id: string; error?: string }>("api_create_web_order", {
    lines: await Promise.all(lines.map(async ([sku, qty]) => ({ product_id: await productId(t.pool, sku), qty }))),
  });
  expect(r.ok, r.error).toBe(true);
  await t.db.rpc("api_mark_order_paid", {
    order_id: r.order_id,
    payment_intent_id: `pi_${r.order_id.slice(0, 8)}`,
    customer: { email: "klant@example.test", name: "Test Klant", street: "Teststraat", house_number: "1", postal_code: "1234 AB", city: "Teststad", country: "NL" },
  });
  return r.order_id;
}

beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

describe("openingsvoorraad", () => {
  it("komt exact overeen met de telling: 341 stuks, 315 protectors en 26 hoesjes", async () => {
    const rows = await q<{ kind: string; n: number }>(t.pool, "select kind, sum(on_hand)::int n from components group by kind order by kind");
    expect(Object.fromEntries(rows.map((r) => [r.kind, r.n]))).toEqual({ case: 26, protector: 315 });
  });

  it("verdubbelt niets en overschrijft niets bij opnieuw uitvoeren na transacties", async () => {
    const ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
    const orderId = await paidWebOrder([["TO-SP2-IP15-PRV", 2]]); // 4 stuks afgeboekt
    await t.db.rpc("api_set_price", { actor: ACTOR, product_id: ip15, channel: "web", price_cents: 2195 });
    const before = await q(t.pool, "select code, on_hand from components order by code");
    const movesBefore = await q<{ n: number }>(t.pool, "select count(*)::int n from stock_movements");

    await t.pool.query(readFileSync(path.join(process.cwd(), "supabase/migrations/20261118120300_catalog_seed.sql"), "utf8"));

    expect(await q(t.pool, "select code, on_hand from components order by code")).toEqual(before);
    expect(await q<{ n: number }>(t.pool, "select count(*)::int n from stock_movements")).toEqual(movesBefore);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(41);
    const [p] = await q<{ web_price_cents: number }>(t.pool, "select web_price_cents from products where id = $1", [ip15]);
    expect(p.web_price_cents).toBe(2195);
    const [o] = await q<{ stock_status: string }>(t.pool, "select stock_status from orders where id = $1", [orderId]);
    expect(o.stock_status).toBe("committed");
  });
});

describe("conceptregels", () => {
  it("zet bundels met een voorgestelde prijs en de twijfelachtige iPhone 14-bol-titel als concept/correctie", async () => {
    const rows = await q<{ sku: string; status: string }>(t.pool, "select sku, status from products where kind = 'bundle' order by sku");
    expect(rows.every((r) => r.status === "concept")).toBe(true);
    const [ip14] = await q<{ bol_title_fix_required: boolean }>(t.pool, "select bol_title_fix_required from products where sku = 'TO-SP2-IP14-STD'");
    expect(ip14.bol_title_fix_required).toBe(true);
    const id = await productId(t.pool, "TO-SP2-IP14-STD");
    await expect(t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true })).rejects.toThrow(/bol_title_fix_required/);
  });

  it("verkoopt een conceptbundel niet", async () => {
    const r = await t.db.rpc<{ ok: boolean; error?: string }>("api_create_web_order", {
      lines: [{ product_id: await productId(t.pool, "TO-BND-IP14-CS-SP1"), qty: 1 }],
    });
    expect(r.ok).toBe(false);
  });

  it("activeert een artikel alleen met prijs, onderdelen en een bevestigd toestel", async () => {
    const bundle = await productId(t.pool, "TO-BND-IP14-CS-SP1");
    // nieuwe bundel zonder bundelprijs kan niet direct actief
    await expect(
      t.db.rpc("api_product_save", {
        actor: ACTOR, kind: "bundle", sku: "TO-BND-TEST-0", slug: "bundel-test-0", title: "Bundel zonder prijs", status: "active",
        web_price_cents: 0, components: [{ component_id: await componentId("C-CS-IP14"), qty: 1 }], devices: [{ slug: "iphone-14" }],
      }),
    ).rejects.toThrow(/webshopprijs ontbreekt/);
    await expect(t.db.rpc("api_product_save", { actor: ACTOR, id: bundle, status: "active", devices: [{ slug: "iphone-14", confirmed: false }] }))
      .rejects.toThrow(/geen bevestigd compatibel toestel/);
    // mislukte poging wijzigt niets (transactie)
    const [b] = await q<{ status: string; web_price_cents: number }>(t.pool, "select status, web_price_cents from products where id = $1", [bundle]);
    expect(b).toEqual({ status: "concept", web_price_cents: 2495 });
    await t.db.rpc("api_product_save", { actor: ACTOR, id: bundle, status: "active" });
    const [a] = await q<{ status: string }>(t.pool, "select status from products where id = $1", [bundle]);
    expect(a.status).toBe("active");
  });

  it("maakt een nieuwe set met nieuw onderdeel aan als concept met voorraad 0, en een nieuw toestel", async () => {
    await t.db.rpc("api_device_save", { actor: ACTOR, slug: "iphone-16", name: "iPhone 16", family: "iPhone 16", sort: 60 });
    const r = await t.db.rpc<{ ok: boolean; id: string }>("api_product_save", {
      actor: ACTOR, kind: "set", product_type: "privacy", sku: "to-sp2-ip16-prv", slug: "Privacy-Screenprotector-iPhone-16",
      title: "Privacy-screenprotector iPhone 16", web_price_cents: 1995, ean: "9500000000016",
      new_component: { code: "c-sp-ip16-prv", name: "Privacy-screenprotector iPhone 16" },
    });
    expect(r.ok).toBe(true);
    const [p] = await q<{ sku: string; slug: string; status: string; kind: string }>(t.pool, "select sku, slug, status, kind from products where id = $1", [r.id]);
    expect(p).toEqual({ sku: "TO-SP2-IP16-PRV", slug: "privacy-screenprotector-iphone-16", status: "concept", kind: "set" });
    expect((await componentOnHand(t.pool, "C-SP-IP16-PRV")).on_hand).toBe(0);
    const [pc] = await q<{ qty: number }>(t.pool, "select qty from product_components where product_id = $1", [r.id]);
    expect(pc.qty).toBe(2);
    await expect(t.db.rpc("api_product_save", { actor: ACTOR, id: r.id, status: "active" })).rejects.toThrow(/bevestigd compatibel toestel/);
    await t.db.rpc("api_product_save", { actor: ACTOR, id: r.id, status: "active", devices: [{ slug: "iphone-16", confirmed: true }] });
    const audit = await q<{ action: string }>(t.pool, "select action from audit_log where entity_id in ($1, 'iphone-16') order by id", [r.id]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["device_created", "product_created", "product_updated"]));
  });

  it("weigert een hoesje aan een protectoronderdeel te koppelen", async () => {
    await expect(
      t.db.rpc("api_product_save", {
        actor: ACTOR, kind: "case", sku: "TO-CS-FOUT", slug: "fout", title: "Fout", web_price_cents: 1995,
        component_id: await componentId("C-SP-IP15-PRV"),
      }),
    ).rejects.toThrow(/Onderdeel past niet/);
  });
});

describe("bol-voorbeelden en gelijktijdigheid", () => {
  it("zet de bol-voorraad op nul bij één vrij hoesje", async () => {
    const cs = await productId(t.pool, "TO-CS-IP13PM-MS");
    await t.db.rpc("api_product_save", { actor: ACTOR, id: cs, bol_enabled: true, bol_offer_id: "offer-cs13pm" });
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: await componentId("C-CS-IP13PM"), mode: "set", value: 1, reason: "test" });
    expect(await target(cs)).toBe(0);
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: await componentId("C-CS-IP13PM"), mode: "set", value: 3, reason: "test" });
    expect(await target(cs)).toBe(2);
  });

  it("verwerkt een bol-order die binnenkomt terwijl een voorraadupdate onderweg is, zonder verouderde stand te laten staan", async () => {
    const ip15p = await productId(t.pool, "TO-SP2-IP15P-PRV"); // 46 stuks = 23 tweepacks
    await t.db.rpc("api_product_save", { actor: ACTOR, id: ip15p, bol_enabled: true, bol_offer_id: "offer-ip15p" });
    const first = await claimFor(ip15p);
    expect(first.value).toBe(22);
    // bol-order (3 tweepacks) komt binnen terwijl de update van 22 nog bij bol ligt
    const imp = await t.db.rpc<{ ok: boolean; new_lines: number; stock_status: string }>("api_bol_import_order", {
      bol_order_id: "BOL-INFLIGHT-1",
      items: [{ order_item_id: "inflight-1", offer_id: "offer-ip15p", qty: 3, unit_price_cents: 1995 }],
    });
    expect(imp).toMatchObject({ ok: true, new_lines: 1, stock_status: "committed" });
    expect(await target(ip15p)).toBe(19);
    expect((await syncRow(ip15p)).status).toBe("in_flight"); // geen tweede update tegelijk
    const second = (await t.db.rpc<Claim>("api_bol_sync_claim", { limit: 50 })).items.find((i) => i.product_id === ip15p && i.kind === "stock");
    expect(second).toBeUndefined();
    await t.db.rpc("api_bol_sync_complete", { product_id: ip15p, kind: "stock", token: first.token, result: "done" });
    expect(await syncRow(ip15p)).toMatchObject({ status: "pending", pushed_value: 22 });
    const next = await claimFor(ip15p);
    expect(next.value).toBe(19);
    await t.db.rpc("api_bol_sync_complete", { product_id: ip15p, kind: "stock", token: next.token, result: "done" });
    expect(await syncRow(ip15p)).toMatchObject({ status: "synced", pushed_value: 19 });
    // dezelfde bol-orderregel nogmaals: geen dubbele afboeking
    const again = await t.db.rpc<{ new_lines: number }>("api_bol_import_order", {
      bol_order_id: "BOL-INFLIGHT-1",
      items: [{ order_item_id: "inflight-1", offer_id: "offer-ip15p", qty: 3, unit_price_cents: 1995 }],
    });
    expect(again.new_lines).toBe(0);
    expect((await componentOnHand(t.pool, "C-SP-IP15P-PRV")).on_hand).toBe(40);
  });

  it("toont een definitieve bol-fout direct als mislukt en herhaalt een tijdelijke fout", async () => {
    const ip15pm = await productId(t.pool, "TO-SP2-IP15PM-PRV");
    await t.db.rpc("api_product_save", { actor: ACTOR, id: ip15pm, bol_enabled: true, bol_offer_id: "offer-ip15pm" });
    let it = await claimFor(ip15pm);
    await t.db.rpc("api_bol_sync_complete", { product_id: ip15pm, kind: "stock", token: it.token, result: "error", error: "HTTP 503" });
    expect(await syncRow(ip15pm)).toMatchObject({ status: "pending", attempts: 1 });
    it = await claimFor(ip15pm);
    await t.db.rpc("api_bol_sync_complete", { product_id: ip15pm, kind: "stock", token: it.token, result: "error", error: "HTTP 422", permanent: true });
    const row = await syncRow(ip15pm);
    expect(row.status).toBe("failed");
    expect(row.last_error).toMatch(/^Definitieve fout/);
    // reconciliatie zet een definitieve fout niet stilletjes opnieuw in de wachtrij
    await t.db.rpc("api_bol_record_remote", { items: [{ product_id: ip15pm, kind: "stock", remote_value: 0 }] });
    expect((await syncRow(ip15pm)).status).toBe("failed");
    // na herstel door de beheerder wel
    await t.db.rpc("api_bol_sync_retry", { actor: ACTOR, product_id: ip15pm, kind: "stock" });
    expect((await syncRow(ip15pm)).status).toBe("pending");
  });

  it("plant een bij bol ontbrekend aanbod niet eindeloos opnieuw in", async () => {
    const ip15pl = await productId(t.pool, "TO-SP2-IP15PL-PRV");
    await t.db.rpc("api_product_save", { actor: ACTOR, id: ip15pl, bol_enabled: true, bol_offer_id: "offer-bestaat-niet" });
    const it = await claimFor(ip15pl);
    await t.db.rpc("api_bol_sync_complete", { product_id: ip15pl, kind: "stock", token: it.token, result: "done" });
    const r1 = await t.db.rpc<{ missing: number; differences: number }>("api_bol_record_remote", {
      items: [{ product_id: ip15pl, kind: "stock", missing: true }],
    });
    expect(r1).toMatchObject({ missing: 1, differences: 0 });
    const row = await syncRow(ip15pl);
    expect(row.status).toBe("failed");
    expect(row.last_error).toMatch(/niet gevonden/);
    const r2 = await t.db.rpc<{ missing: number }>("api_bol_record_remote", { items: [{ product_id: ip15pl, kind: "stock", missing: true }] });
    expect(r2.missing).toBe(1);
    const claim = (await t.db.rpc<Claim>("api_bol_sync_claim", { limit: 50 })).items.find((i) => i.product_id === ip15pl && i.kind === "stock");
    expect(claim).toBeUndefined();
  });
});

describe("verzendvoorstel", () => {
  it("sluit briefpost uit boven de gewichtsgrens, ook met trackingoverschrijving", async () => {
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "letter_max_weight_g", value: 100 });
    const id = await paidWebOrder([["TO-CS-IP14-MS", 2]]); // 2 × 90 g
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier: "letter", override_tracking: true });
    expect(prep.error).toBe("carrier_not_allowed");
    expect(prep.allowed).toEqual(["dhl", "postnl"]);
    const ok = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id });
    expect(ok).toMatchObject({ ok: true, carrier: "dhl", weight_g: 180 });
    expect(ok.notes.join(" ")).toMatch(/briefpost uitgesloten/);
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "letter_max_weight_g", value: 250 });
  });

  it("staat briefpost met overschrijving toe voor een lichte webshoporder", async () => {
    const id = await paidWebOrder([["TO-SP2-IP14PM-PRV", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier: "letter", override_tracking: true });
    expect(prep).toMatchObject({ ok: true, carrier: "letter" });
  });

  it("verstuurt een bol-order met trackingplicht nooit als briefpost", async () => {
    const ip14pm = await productId(t.pool, "TO-SP2-IP14PM-PRV");
    await t.db.rpc("api_product_save", { actor: ACTOR, id: ip14pm, bol_enabled: true, bol_offer_id: "offer-ip14pm" });
    const imp = await t.db.rpc<{ order_id: string }>("api_bol_import_order", {
      bol_order_id: "BOL-LETTER-1",
      items: [{ order_item_id: "letter-1", offer_id: "offer-ip14pm", qty: 1, unit_price_cents: 1995 }],
      customer: { name: "Bol Klant", street: "Bolstraat", house_number: "2", postal_code: "1234 AB", city: "Utrecht", country: "NL" },
    });
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: imp.order_id, carrier: "letter", override_tracking: true });
    expect(prep.error).toBe("carrier_not_allowed");
  });
});

describe("auditlogboek", () => {
  it("is alleen-toevoegen", async () => {
    await expect(t.pool.query("update audit_log set actor = 'x'")).rejects.toThrow(/alleen-toevoegen/);
    await expect(t.pool.query("delete from audit_log")).rejects.toThrow(/alleen-toevoegen/);
  });
});
