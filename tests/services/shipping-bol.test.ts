import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testCtx } from "../helpers/ctx";
import { componentOnHand, freshDb, productId, q, type TestDb } from "../helpers/db";
import { applyCarrierEvent, confirmHandover, createLabel, dayPdf, labelPdf, prepareShipment, uploadLabel } from "@/server/services/shipping";
import { importBolOrder, processBolQueue, processOutbox, reconcileBol } from "@/server/services/bol-sync";
import { renderLabel } from "@/server/pdf/labels";

let t: TestDb;
const ACTOR = "test:admin";
let ip15: string;
let ip12pm: string;
let comp12pm: string;

async function paidOrder(qty = 1, customer: Record<string, string> = {}) {
  const r = await t.db.rpc<{ ok: boolean; order_id: string; number: string }>("api_create_web_order", { lines: [{ product_id: ip15, qty }] });
  await t.db.rpc("api_mark_order_paid", {
    order_id: r.order_id,
    payment_intent_id: `pi_${r.order_id.slice(0, 6)}`,
    customer: { email: "klant@example.test", name: "Test Klant", street: "Teststraat", house_number: "1", postal_code: "1234 AB", city: "Teststad", country: "NL", ...customer },
  });
  return r;
}

function files(dir: string) {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name));
      else out.push(path.join(d, f.name));
    }
  };
  walk(dir);
  return out;
}

beforeAll(async () => {
  t = await freshDb();
  ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
  ip12pm = await productId(t.pool, "TO-SP2-IP12PM-PRV");
  comp12pm = (await q<{ id: string }>(t.pool, "select id from components where code = 'C-SP-IP12PM-PRV'"))[0].id;
  await t.db.rpc("api_setting_save", {
    actor: ACTOR,
    key: "sender_address",
    value: { name: "Timber Online", street: "Voorbeeldweg", house_number: "1", postal_code: "1000 AA", city: "Amsterdam", country: "NL" },
  });
});
afterAll(async () => t.close());

describe("labels en PDF's", () => {
  it("maakt een DHL-voorbeeldlabel en hergebruikt het bij herdruk en dubbele aanvragen", async () => {
    const { ctx, storageDir } = testCtx(t.db);
    const o = await paidOrder();
    const res = (await prepareShipment(ctx, ACTOR, o.order_id)) as { ok: boolean; carrier: string; shipment_id: string; label: { ok: boolean } };
    expect(res).toMatchObject({ ok: true, carrier: "dhl", label: { ok: true } });
    const again = (await prepareShipment(ctx, ACTOR, o.order_id)) as { label: { reuse: boolean } };
    expect(again.label.reuse).toBe(true);
    const parallel = await Promise.all([createLabel(ctx, ACTOR, res.shipment_id), createLabel(ctx, ACTOR, res.shipment_id)]);
    expect(parallel.every((p) => p.ok && p.reuse)).toBe(true);
    expect(files(storageDir)).toHaveLength(1);
    const pdf = await labelPdf(ctx, res.shipment_id);
    const doc = await PDFDocument.load(pdf!.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(283); // 100 mm
    const [s] = await q<{ status: string; tracking_code: string }>(t.pool, "select status, tracking_code from shipments where id = $1", [res.shipment_id]);
    expect(s.status).toBe("label_ready");
    expect(s.tracking_code).toMatch(/^SIMDHL/);
  });

  it("maakt een PostNL-voorbeeldlabel en een adreslabel voor briefpost", async () => {
    const { ctx } = testCtx(t.db);
    const a = await paidOrder();
    const p = (await prepareShipment(ctx, ACTOR, a.order_id, "postnl")) as { ok: boolean; shipment_id: string };
    expect(p.ok).toBe(true);
    const [s] = await q<{ tracking_code: string; label_source: string }>(t.pool, "select tracking_code, label_source from shipments where id = $1", [p.shipment_id]);
    expect(s).toMatchObject({ label_source: "simulated" });
    expect(s.tracking_code).toMatch(/^SIM3S/);
    const b = await paidOrder();
    const l = (await prepareShipment(ctx, ACTOR, b.order_id, "letter", true)) as { ok: boolean; shipment_id: string };
    expect(l.ok).toBe(true);
    const [ls] = await q<{ tracking_code: string | null; label_source: string }>(t.pool, "select tracking_code, label_source from shipments where id = $1", [l.shipment_id]);
    expect(ls).toEqual({ tracking_code: null, label_source: "letter" });
  });

  it("combineert alle labels van een verzenddag in één printbare PDF", async () => {
    const { ctx, storageDir } = testCtx(t.db);
    const ids: string[] = [];
    // eerdere tests gebruikten eigen opslag; begin deze dag schoon door oudere zendingen te annuleren
    await t.pool.query("update shipments set status = 'cancelled' where status in ('draft', 'label_ready')");
    void storageDir;
    for (let i = 0; i < 3; i++) {
      const o = await paidOrder();
      const r = (await prepareShipment(ctx, ACTOR, o.order_id)) as { shipment_id: string };
      ids.push(r.shipment_id);
    }
    const [{ d }] = await q<{ d: string }>(t.pool, "select ((now() at time zone 'Europe/Amsterdam')::date)::text d");
    const day = await dayPdf(ctx, d);
    const doc = await PDFDocument.load(day!.bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(ids).toHaveLength(3);
    expect(day!.filename).toBe(`labels-${d}.pdf`);
  });

  it("accepteert een geüpload label (PNG) en zet het om naar PDF", async () => {
    const { ctx } = testCtx(t.db);
    const o = await paidOrder();
    const r = await t.db.rpc<{ shipment_id: string }>("api_shipment_prepare", { actor: ACTOR, order_id: o.order_id, carrier: "postnl" });
    const png = readFileSync("public/brand/appicon-blue-192.png");
    const up = await uploadLabel(ctx, ACTOR, r.shipment_id, { bytes: new Uint8Array(png), type: "image/png" }, { code: "3SXYZ0001" });
    expect(up.ok).toBe(true);
    const pdf = await labelPdf(ctx, r.shipment_id);
    expect((await PDFDocument.load(pdf!.bytes)).getPageCount()).toBe(1);
    const bad = await uploadLabel(ctx, ACTOR, r.shipment_id, { bytes: new Uint8Array([1, 2]), type: "text/plain" });
    expect(bad.ok).toBe(false);
  });

  it("toont een ontbrekend afzenderadres op het label in plaats van te falen", async () => {
    const bytes = await renderLabel({ carrier: "dhl", orderNumber: "TO1", shipDate: "2026-11-18", weightG: 60, to: { name: "A", street: "B", house_number: "1", postal_code: "1234 AB", city: "C" }, from: null, simulated: true, trackingCode: "SIM1" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("verzendbericht", () => {
  it("stuurt één verzendmail bij overdracht, ook bij dubbele scans en handmatige bevestiging", async () => {
    const { ctx, sink } = testCtx(t.db);
    const o = await paidOrder();
    const r = (await prepareShipment(ctx, ACTOR, o.order_id)) as { shipment_id: string };
    expect(sink).toHaveLength(0); // label klaar = nog geen verzendbericht
    await applyCarrierEvent(ctx, { shipment_id: r.shipment_id, status: "in_transit", event_key: `k1-${r.shipment_id}` });
    await applyCarrierEvent(ctx, { shipment_id: r.shipment_id, status: "in_transit", event_key: `k1-${r.shipment_id}` });
    await applyCarrierEvent(ctx, { shipment_id: r.shipment_id, status: "in_transit", event_key: `k2-${r.shipment_id}` });
    await confirmHandover(ctx, ACTOR, r.shipment_id);
    const shipped = sink.filter((m) => m.subject.includes("onderweg"));
    expect(shipped).toHaveLength(1);
    expect(shipped[0].html).toContain("Track &amp; trace");
  });

  it("stuurt bij briefpost het bericht pas na handmatige bevestiging", async () => {
    const { ctx, sink } = testCtx(t.db);
    const o = await paidOrder();
    const r = (await prepareShipment(ctx, ACTOR, o.order_id, "letter", true)) as { shipment_id: string };
    expect(sink).toHaveLength(0);
    await confirmHandover(ctx, ACTOR, r.shipment_id);
    expect(sink).toHaveLength(1);
    expect(sink[0].html).toContain("briefpost");
  });
});

describe("bol-koppeling (gesimuleerd)", () => {
  it("verwerkt mislukte en vertraagde updates veilig en eindigt op de nieuwste stand", async () => {
    await t.db.rpc("api_product_save", { actor: ACTOR, id: ip12pm, bol_enabled: true, bol_offer_id: "sim-offer-12pm" });
    const { ctx, bol } = testCtx(t.db, { bolFaults: { failNext: 1 } });
    const first = await processBolQueue(ctx);
    expect(first.some((r) => r.result === "error")).toBe(true);
    await t.pool.query("update bol_sync set next_attempt_at = now() where product_id = $1", [ip12pm]);
    // vertraagde update: tijdens de push verandert de voorraad
    bol.faults.delayMs = 150;
    const pending = processBolQueue(ctx);
    await new Promise((r) => setTimeout(r, 40));
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: comp12pm, mode: "set", value: 9, reason: "levering tijdens sync" });
    await pending;
    bol.faults.delayMs = 0;
    await processBolQueue(ctx);
    const [sim] = await q<{ stock: number }>(t.pool, "select stock from bol_sim_offers where offer_key = 'sim-offer-12pm'");
    expect(sim.stock).toBe(3); // 9 stuks = 4 tweepacks − 1 buffer
    const [row] = await q<{ status: string; pushed_value: number }>(t.pool, "select status, pushed_value from bol_sync where product_id = $1 and kind = 'stock'", [ip12pm]);
    expect(row).toEqual({ status: "synced", pushed_value: 3 });
    const rec = await reconcileBol(ctx);
    expect(rec.differences).toBe(0);
  });

  it("verwerkt een bol-order, werkt de voorraad bij en meldt de verzending één keer aan bol", async () => {
    const { ctx, bol } = testCtx(t.db);
    const before = await componentOnHand(t.pool, "C-SP-IP12PM-PRV");
    const order = {
      bol_order_id: "BOL-E2E-1",
      customer: { name: "Bol Klant", street: "Bolstraat", house_number: "5", postal_code: "3511 AB", city: "Utrecht", country: "NL" },
      items: [{ order_item_id: "e2e-1", offer_id: "sim-offer-12pm", qty: 1, unit_price_cents: 1995 }],
    };
    const r1 = await importBolOrder(ctx, order);
    const r2 = await importBolOrder(ctx, order);
    expect(r1.new_lines).toBe(1);
    expect(r2.new_lines).toBe(0);
    expect((await componentOnHand(t.pool, "C-SP-IP12PM-PRV")).on_hand).toBe(before.on_hand - 2);
    const [sim] = await q<{ stock: number }>(t.pool, "select stock from bol_sim_offers where offer_key = 'sim-offer-12pm'");
    expect(sim.stock).toBe(2); // 7 stuks = 3 tweepacks − 1
    const r = (await prepareShipment(ctx, ACTOR, r1.order_id)) as { ok: boolean; shipment_id: string };
    expect(r.ok).toBe(true);
    await confirmHandover(ctx, ACTOR, r.shipment_id); // handmatige overdracht (vertraagde scan)
    await applyCarrierEvent(ctx, { shipment_id: r.shipment_id, status: "in_transit", event_key: `bol-e2e-${r.shipment_id}` });
    await processOutbox(ctx);
    expect(bol.shipments).toHaveLength(1);
    expect(bol.shipments[0]).toMatchObject({ orderItemIds: ["e2e-1"], carrier: "dhl" });
  });

  it("herprobeert een mislukte verzendbevestiging naar bol zonder dubbel te melden", async () => {
    const { ctx, bol } = testCtx(t.db, { bolFaults: { failNext: 1 } });
    const order = { bol_order_id: "BOL-E2E-2", customer: { name: "Bol Klant", street: "Bolstraat", house_number: "5", postal_code: "3511 AB", city: "Utrecht" }, items: [{ order_item_id: "e2e-2", offer_id: "sim-offer-12pm", qty: 1, unit_price_cents: 1995 }] };
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: comp12pm, mode: "set", value: 9, reason: "test" });
    bol.faults.failNext = 0;
    const r1 = await importBolOrder(ctx, order);
    const r = (await prepareShipment(ctx, ACTOR, r1.order_id)) as { shipment_id: string };
    bol.faults.failNext = 1;
    await confirmHandover(ctx, ACTOR, r.shipment_id);
    expect(bol.shipments).toHaveLength(0);
    const [ob] = await q<{ status: string; attempts: number }>(t.pool, "select status, attempts from outbox where payload->>'order_id' = $1", [r1.order_id]);
    expect(ob).toEqual({ status: "pending", attempts: 1 });
    await t.pool.query("update outbox set next_attempt_at = now() where payload->>'order_id' = $1", [r1.order_id]);
    await processOutbox(ctx);
    await processOutbox(ctx);
    expect(bol.shipments).toHaveLength(1);
  });
});
