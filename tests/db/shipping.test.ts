import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, productId, q, type TestDb } from "../helpers/db";

let t: TestDb;
const ACTOR = "test:admin";
const P: Record<string, string> = {};

async function paidWebOrder(lines: [string, number][], customer: Record<string, string> = {}) {
  const r = await t.db.rpc<{ ok: boolean; order_id: string }>("api_create_web_order", {
    lines: lines.map(([sku, qty]) => ({ product_id: P[sku], qty })),
  });
  expect(r.ok).toBe(true);
  await t.db.rpc("api_mark_order_paid", {
    order_id: r.order_id,
    payment_intent_id: `pi_${r.order_id.slice(0, 6)}`,
    customer: { email: "klant@example.test", name: "Test Klant", street: "Teststraat", house_number: "1", postal_code: "1234 AB", city: "Teststad", country: "NL", ...customer },
  });
  return r.order_id;
}
type Prep = { ok: boolean; shipment_id: string; carrier: string; error?: string; allowed: string[]; address_problems: string[] };

beforeAll(async () => {
  t = await freshDb();
  for (const sku of ["TO-SP2-IP15-PRV", "TO-BND-IP14-CS-SP2", "TO-CS-IP14-MS"]) P[sku] = await productId(t.pool, sku);
});
afterAll(async () => t.close());

describe("vervoerderskeuze", () => {
  it("kiest DHL als algemene voorkeur en weigert briefpost als track & trace is beloofd", async () => {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id });
    expect(prep).toMatchObject({ ok: true, carrier: "dhl" });
    expect(prep.allowed).toEqual(["dhl", "postnl"]);
    const letter = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier: "letter" });
    expect(letter.error).toBe("carrier_not_allowed");
    const postnl = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier: "postnl" });
    expect(postnl).toMatchObject({ ok: true, carrier: "postnl", shipment_id: prep.shipment_id });
  });

  it("respecteert de toegestane methoden per variant", async () => {
    // bundel staat alleen DHL en PostNL toe; hoesje alles
    const id = await paidWebOrder([["TO-BND-IP14-CS-SP2", 1], ["TO-CS-IP14-MS", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier: "letter", override_tracking: true });
    expect(prep.error).toBe("carrier_not_allowed");
    expect(prep.allowed).toEqual(["dhl", "postnl"]);
  });

  it("weigert verzending van een onbetaalde order", async () => {
    const r = await t.db.rpc<{ order_id: string }>("api_create_web_order", { lines: [{ product_id: P["TO-SP2-IP15-PRV"], qty: 1 }] });
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: r.order_id });
    expect(prep.error).toBe("order_not_ready");
  });
});

describe("labels", () => {
  it("maakt bij gelijktijdige aanvragen maar één label en hergebruikt het daarna", async () => {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id });
    const claims = await Promise.all(
      [1, 2, 3].map(() => t.db.rpc<{ ok: boolean; token?: string; error?: string }>("api_label_claim", { shipment_id: prep.shipment_id })),
    );
    const winners = claims.filter((c) => c.ok && c.token);
    expect(winners).toHaveLength(1);
    expect(claims.filter((c) => c.error === "busy")).toHaveLength(2);
    await t.db.rpc("api_label_complete", {
      shipment_id: prep.shipment_id,
      token: winners[0].token,
      ok: true,
      label_path: "labels/x.pdf",
      label_source: "simulated",
      tracking_code: "JVGL0000001",
    });
    const again = await t.db.rpc<{ reuse: boolean; label_path: string }>("api_label_claim", { shipment_id: prep.shipment_id });
    expect(again).toMatchObject({ reuse: true, label_path: "labels/x.pdf" });
    const [s] = await q<{ status: string }>(t.pool, "select status from shipments where id = $1", [prep.shipment_id]);
    expect(s.status).toBe("label_ready");
    const changeCarrier = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier: "postnl" });
    expect(changeCarrier.error).toBe("label_exists");
  });

  it("toont een mislukte labelaanvraag als uitzondering en staat een nieuwe poging toe", async () => {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id });
    const c = await t.db.rpc<{ token: string }>("api_label_claim", { shipment_id: prep.shipment_id });
    await t.db.rpc("api_label_complete", { shipment_id: prep.shipment_id, token: c.token, ok: false, error: "DHL API 500" });
    const [s] = await q<{ status: string; exception_reason: string }>(t.pool, "select status, exception_reason from shipments where id = $1", [prep.shipment_id]);
    expect(s.status).toBe("exception");
    expect(s.exception_reason).toMatch(/DHL API 500/);
    const retry = await t.db.rpc<{ ok: boolean; token: string }>("api_label_claim", { shipment_id: prep.shipment_id });
    expect(retry.ok).toBe(true);
  });

  it("blokkeert labels bij adresproblemen", async () => {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]], { postal_code: "12AB", house_number: "" });
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id });
    expect(prep.address_problems).toEqual(expect.arrayContaining(["Huisnummer ontbreekt", "Postcode heeft geen geldig NL-formaat"]));
    const c = await t.db.rpc<{ ok: boolean; error: string }>("api_label_claim", { shipment_id: prep.shipment_id });
    expect(c.error).toBe("address_problem");
  });

  it("accepteert een elders gekocht label met handmatige trackingcode", async () => {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier: "postnl" });
    await t.db.rpc("api_label_attach_upload", { actor: ACTOR, shipment_id: prep.shipment_id, label_path: "labels/upload.pdf", tracking_code: "3SABCD123" });
    const [s] = await q<{ label_status: string; label_source: string; tracking_code: string }>(
      t.pool,
      "select label_status, label_source, tracking_code from shipments where id = $1",
      [prep.shipment_id],
    );
    expect(s).toEqual({ label_status: "ready", label_source: "uploaded", tracking_code: "3SABCD123" });
  });
});

describe("overdracht en statussen", () => {
  async function readyShipment(carrier = "dhl", override = false) {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id, carrier, override_tracking: override });
    const c = await t.db.rpc<{ token: string }>("api_label_claim", { shipment_id: prep.shipment_id });
    await t.db.rpc("api_label_complete", {
      shipment_id: prep.shipment_id,
      token: c.token,
      ok: true,
      label_path: `labels/${prep.shipment_id}.pdf`,
      label_source: carrier === "letter" ? "letter" : "simulated",
      tracking_code: carrier === "letter" ? null : `SIM${prep.shipment_id.slice(0, 8)}`,
    });
    return { orderId: id, shipmentId: prep.shipment_id };
  }

  it("meldt de eerste overdracht één keer, ook bij dubbele vervoerdersgebeurtenissen", async () => {
    const { shipmentId, orderId } = await readyShipment();
    const ev = { shipment_id: shipmentId, status: "in_transit", event_key: `dhl:${shipmentId}:scan1` };
    const results = await Promise.all([
      t.db.rpc<{ send_shipped_email: boolean; duplicate?: boolean }>("api_shipment_carrier_event", ev),
      t.db.rpc<{ send_shipped_email: boolean; duplicate?: boolean }>("api_shipment_carrier_event", ev),
    ]);
    expect(results.filter((r) => r.send_shipped_email)).toHaveLength(1);
    const second = await t.db.rpc<{ send_shipped_email: boolean }>("api_shipment_carrier_event", { ...ev, event_key: `dhl:${shipmentId}:scan2` });
    expect(second.send_shipped_email).toBe(false);
    const manual = await t.db.rpc<{ first_handover: boolean }>("api_shipment_handover", { actor: ACTOR, shipment_id: shipmentId });
    expect(manual.first_handover).toBe(false);
    await t.db.rpc("api_shipment_carrier_event", { shipment_id: shipmentId, status: "delivered", event_key: `dhl:${shipmentId}:del` });
    await t.db.rpc("api_shipment_carrier_event", { shipment_id: shipmentId, status: "in_transit", event_key: `dhl:${shipmentId}:late-scan` });
    const [s] = await q<{ status: string }>(t.pool, "select status from shipments where id = $1", [shipmentId]);
    expect(s.status).toBe("delivered");
    const [o] = await q<{ fulfillment_status: string }>(t.pool, "select fulfillment_status from orders where id = $1", [orderId]);
    expect(o.fulfillment_status).toBe("delivered");
  });

  it("zet 'Klaar om af te halen' op basis van de vervoerdersstatus", async () => {
    const { shipmentId, orderId } = await readyShipment("postnl");
    await t.db.rpc("api_shipment_carrier_event", { shipment_id: shipmentId, status: "ready_for_pickup", event_key: `p:${shipmentId}:pickup` });
    const [o] = await q<{ fulfillment_status: string }>(t.pool, "select fulfillment_status from orders where id = $1", [orderId]);
    expect(o.fulfillment_status).toBe("ready_for_pickup");
  });

  it("ondersteunt briefpost met handmatige bevestiging na het posten", async () => {
    await t.pool.query(
      `update settings set value = jsonb_set(value, '{1,enabled}', 'true') where key = 'shipping_options'`,
    );
    const r = await t.db.rpc<{ ok: boolean; order_id: string }>("api_create_web_order", {
      lines: [{ product_id: P["TO-SP2-IP15-PRV"], qty: 1 }],
      shipping_option: "letter",
    });
    expect(r.ok).toBe(true);
    await t.db.rpc("api_mark_order_paid", {
      order_id: r.order_id,
      payment_intent_id: "pi_letter",
      customer: { email: "k@example.test", name: "Brief Klant", street: "Postweg", house_number: "2", postal_code: "1000 AA", city: "Amsterdam", country: "NL" },
    });
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: r.order_id });
    expect(prep.carrier).toBe("letter"); // standaard binnen de door de klant gekozen verzendoptie
    const letter = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: r.order_id, carrier: "letter" });
    expect(letter.ok).toBe(true);
    const c = await t.db.rpc<{ token: string }>("api_label_claim", { shipment_id: letter.shipment_id });
    await t.db.rpc("api_label_complete", { shipment_id: letter.shipment_id, token: c.token, ok: true, label_path: "labels/letter.pdf", label_source: "letter" });
    const h = await t.db.rpc<{ send_shipped_email: boolean }>("api_shipment_handover", { actor: ACTOR, shipment_id: letter.shipment_id });
    expect(h.send_shipped_email).toBe(true);
    const h2 = await t.db.rpc<{ send_shipped_email: boolean }>("api_shipment_handover", { actor: ACTOR, shipment_id: letter.shipment_id });
    expect(h2.send_shipped_email).toBe(false);
  });

  it("zet de verzendbevestiging voor bol-orders één keer klaar, ook bij handmatige overdracht", async () => {
    const id15 = P["TO-SP2-IP15-PRV"];
    await t.db.rpc("api_product_save", { actor: ACTOR, id: id15, bol_enabled: true, bol_offer_id: "offer-ip15" });
    const imp = await t.db.rpc<{ order_id: string }>("api_bol_import_order", {
      bol_order_id: "BOL-SHIP-1",
      customer: { name: "Bol Klant", street: "Bolstraat", house_number: "5", postal_code: "3511 AB", city: "Utrecht", country: "NL" },
      items: [{ order_item_id: "ship-item-1", offer_id: "offer-ip15", qty: 1, unit_price_cents: 1995 }],
    });
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: imp.order_id });
    expect(prep.allowed).not.toContain("letter"); // bol vereist tracking
    const c = await t.db.rpc<{ token: string }>("api_label_claim", { shipment_id: prep.shipment_id });
    await t.db.rpc("api_label_complete", { shipment_id: prep.shipment_id, token: c.token, ok: true, label_path: "l.pdf", label_source: "simulated", tracking_code: "JVGLBOL1" });
    const h = await t.db.rpc<{ send_shipped_email: boolean; first_handover: boolean }>("api_shipment_handover", { actor: ACTOR, shipment_id: prep.shipment_id });
    expect(h).toMatchObject({ first_handover: true, send_shipped_email: false });
    await t.db.rpc("api_shipment_carrier_event", { shipment_id: prep.shipment_id, status: "in_transit", event_key: "dhl:bol:1" });
    const rows = await q<{ kind: string; status: string }>(t.pool, "select kind, status from outbox where payload->>'order_id' = $1", [imp.order_id]);
    expect(rows).toEqual([{ kind: "bol_shipment", status: "pending" }]);
    const [audit] = await q<{ action: string }>(t.pool, "select action from audit_log where entity_id = $1 and action like 'handover%'", [prep.shipment_id]);
    expect(audit.action).toBe("handover_confirmed_manual");
  });

  it("weigert overdracht zonder label of trackingcode", async () => {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]]);
    const prep = await t.db.rpc<Prep>("api_shipment_prepare", { actor: ACTOR, order_id: id });
    const h = await t.db.rpc<{ ok: boolean; error: string }>("api_shipment_handover", { actor: ACTOR, shipment_id: prep.shipment_id });
    expect(h.error).toBe("label_missing");
  });
});

describe("e-mail", () => {
  it("claimt elk soort bericht maar één keer per order", async () => {
    const id = await paidWebOrder([["TO-SP2-IP15-PRV", 1]]);
    const claims = await Promise.all(
      [1, 2, 3].map(() => t.db.rpc<{ claimed: boolean; id: string }>("api_email_claim", { order_id: id, kind: "shipped", to: "k@example.test" })),
    );
    expect(claims.filter((c) => c.claimed)).toHaveLength(1);
    const winner = claims.find((c) => c.claimed)!;
    await t.db.rpc("api_email_complete", { id: winner.id, status: "failed", error: "timeout" });
    const retry = await t.db.rpc<{ claimed: boolean; id: string }>("api_email_claim", { order_id: id, kind: "shipped", to: "k@example.test" });
    expect(retry.claimed).toBe(true);
    await t.db.rpc("api_email_complete", { id: retry.id, status: "sent", provider_id: "re_123" });
    const after = await t.db.rpc<{ claimed: boolean }>("api_email_claim", { order_id: id, kind: "shipped", to: "k@example.test" });
    expect(after.claimed).toBe(false);
  });
});

describe("dagoverzicht", () => {
  it("levert labels van één verzenddag voor de gecombineerde PDF", async () => {
    const today = (await q<{ d: string }>(t.pool, "select ((now() at time zone 'Europe/Amsterdam')::date)::text d"))[0].d;
    const labels = await t.db.rpc<{ label_path: string }[]>("api_day_labels", { date: today });
    expect(labels.length).toBeGreaterThan(0);
    const view = await t.db.rpc<{ day: unknown[]; open: unknown[] }>("api_admin_shipments", { date: today });
    expect(view.day.length).toBeGreaterThan(0);
  });
});
