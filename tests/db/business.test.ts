import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSimulatedMail, type MailMessage } from "@/server/integrations/mail";
import { checkoutSubmitMessage } from "@/server/services/checkout";
import { renderEmail } from "@/server/services/email";
import { renderWithdrawalAck, sendWithdrawalAck, submitWithdrawal, validateWithdrawal } from "@/server/services/withdrawal";
import { createRateLimiter } from "@/server/services/contact";
import type { OrderForEmail } from "@/server/services/types";
import { freshDb, productId, q, type TestDb } from "../helpers/db";

/** Bedrijfsgegevens, verkopergegevens per order en de online herroepingsfunctie (19-11-2026). */
let t: TestDb;
const ACTOR = "test:owner";
const BUSINESS = {
  legal_name: "Timber Services", shop_name: "Timber Online", street: "Abel Tasmanstraat", house_number: "22", postal_code: "6413 SX",
  city: "Heerlen", country: "NL", kvk: "88562700", vat_id: "NL004626847B65", phone: "+31 6 17028248", email: "timberonline@timberservices.nl",
};

beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.close();
});

async function webOrder(email = "klant@example.test") {
  const r = await t.db.rpc<{ ok: boolean; order_id: string; number: string }>("api_create_web_order", {
    lines: [{ product_id: await productId(t.pool, "TO-SP2-IP15-PRV"), qty: 1 }],
  });
  expect(r.ok).toBe(true);
  await t.pool.query("update orders set email = $2 where id = $1", [r.order_id, email]);
  return r;
}

describe("bedrijfsgegevens", () => {
  it("staan na de migratie in de instellingen, met afzender- en retouradres en nog niet bevestigd", async () => {
    const s = await t.db.rpc<Record<string, Record<string, unknown>>>("api_admin_settings", {});
    expect(s.business_info).toMatchObject({ ...BUSINESS, confirmed_at: null });
    for (const key of ["sender_address", "return_address"]) {
      expect(s[key]).toMatchObject({ name: "Timber Online", street: "Abel Tasmanstraat", house_number: "22", postal_code: "6413 SX", city: "Heerlen", confirmed_at: null });
    }
    const audit = await q<{ entity_id: string }>(t.pool, "select entity_id from audit_log where action = 'setting_changed' and actor = 'migration'");
    expect(audit.map((a) => a.entity_id).sort()).toEqual(["business_info", "return_address", "sender_address"]);
  });

  it("publieke API geeft geen bevestigings- of bronmetadata", async () => {
    const p = await t.db.rpc<{ business: Record<string, unknown>; return_address: Record<string, unknown> }>("api_public_business", {});
    expect(p.business).toEqual(BUSINESS);
    expect(p.return_address).not.toHaveProperty("confirmed_at");
  });

  it("opslaan zonder wijziging levert geen logregel op; een wijziging wel", async () => {
    const count = async () => Number((await q<{ n: string }>(t.pool, "select count(*) n from audit_log where entity_id = 'return_address'"))[0].n);
    const before = await count();
    const current = (await t.db.rpc<Record<string, unknown>>("api_admin_settings", {})).return_address;
    expect(await t.db.rpc("api_setting_save", { actor: ACTOR, key: "return_address", value: current })).toEqual({ ok: true, changed: false });
    expect(await count()).toBe(before);
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "return_address", value: { ...(current as object), city: "Kerkrade" } });
    expect(await count()).toBe(before + 1);
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "return_address", value: current });
  });

  it("weigert een adres dat geen object is", async () => {
    await expect(t.db.rpc("api_setting_save", { actor: ACTOR, key: "business_info", value: "Timber" })).rejects.toThrow(/invalid_setting/);
  });
});

describe("verkopergegevens per order (historie)", () => {
  it("een nieuwe order krijgt een vaste kopie; een latere wijziging van de instellingen verandert die niet", async () => {
    const r = await webOrder();
    const [o] = await q<{ seller: { business: Record<string, unknown>; return_address: Record<string, unknown>; captured_at: string } }>(
      t.pool, "select seller from orders where id = $1", [r.order_id]);
    expect(o.seller.business).toEqual(BUSINESS);
    expect(o.seller.return_address).toMatchObject({ street: "Abel Tasmanstraat", city: "Heerlen" });

    const cur = (await t.db.rpc<Record<string, Record<string, unknown>>>("api_admin_settings", {})).business_info;
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "business_info", value: { ...cur, phone: "+31 6 00000000" } });
    const [after] = await q<{ seller: { business: { phone: string } } }>(t.pool, "select seller from orders where id = $1", [r.order_id]);
    expect(after.seller.business.phone).toBe("+31 6 17028248");
    const mail = await t.db.rpc<OrderForEmail>("api_order_for_email", { order_id: r.order_id });
    expect(mail.seller?.business.phone).toBe("+31 6 17028248");
    // nieuwe order: nieuwe gegevens
    const r2 = await webOrder();
    const [o2] = await q<{ seller: { business: { phone: string } } }>(t.pool, "select seller from orders where id = $1", [r2.order_id]);
    expect(o2.seller.business.phone).toBe("+31 6 00000000");
    await t.db.rpc("api_setting_save", { actor: ACTOR, key: "business_info", value: cur });
  });

  it("de kopie kan niet worden overschreven, wel blijven andere orderupdates werken", async () => {
    const r = await webOrder();
    await expect(t.pool.query("update orders set seller = '{}'::jsonb where id = $1", [r.order_id])).rejects.toThrow(/seller_snapshot_immutable/);
    await t.pool.query("update orders set customer_name = 'Test' where id = $1", [r.order_id]);
  });
});

describe("online herroeping", () => {
  const limiter = () => createRateLimiter({ limit: 5, windowMs: 60_000 });
  const values = (over: Record<string, string> = {}) => ({ name: "Test Klant", email: "klant@example.test", order_number: "", scope: "all", items: "", note: "", ...over });

  it("valideert invoer (deel van de bestelling vraagt welke artikelen)", () => {
    const r = validateWithdrawal(values({ order_number: "TO100001", scope: "partial" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.items).toMatch(/welke artikelen/);
    expect(validateWithdrawal(values({ order_number: "to 100001" })).ok).toBe(true);
  });

  it("legt vast, koppelt aan de juiste order en stuurt precies één ontvangstbevestiging met datum en tijd", async () => {
    const order = await webOrder("Klant@Example.test");
    const sink: MailMessage[] = [];
    const mail = createSimulatedMail(sink);
    const res = await submitWithdrawal(values({ order_number: order.number.toLowerCase(), email: "klant@example.test", note: "Past niet" }), {
      db: t.db, mail, appUrl: "https://shop.test", clientKey: "ip1", limiter: limiter(),
    });
    expect(res.status).toBe("received");
    if (res.status !== "received") return;
    expect(res.reference).toMatch(/^HR-\d{8}-[0-9A-F]{6}$/);
    const [w] = await q<{ id: string; order_id: string; ack_status: string; ack_sent_at: string | null }>(t.pool, "select id, order_id, ack_status, ack_sent_at from withdrawals where reference = $1", [res.reference]);
    expect(w.order_id).toBe(order.order_id);
    expect(w.ack_status).toBe("simulated");
    expect(w.ack_sent_at).not.toBeNull();
    const ack = sink.find((m) => m.to === "klant@example.test")!;
    expect(ack.subject).toContain(res.reference);
    expect(ack.text).toMatch(/Ontvangen op: \d{2}-\d{2}-\d{4} om \d{2}:\d{2}:\d{2}/);
    expect(ack.text).toContain("Past niet");
    expect(ack.text).toContain("Abel Tasmanstraat 22, 6413 SX Heerlen");
    expect(ack.replyTo).toBe("timberonline@timberservices.nl");
    // nogmaals versturen kan niet (claim)
    expect(await sendWithdrawalAck({ db: t.db, mail, appUrl: "https://shop.test" }, w.id)).toBe(false);
    expect(sink.filter((m) => m.to === "klant@example.test")).toHaveLength(1);
    // de order zelf is niet gewijzigd
    const [o] = await q<{ needs_attention: boolean }>(t.pool, "select needs_attention from orders where id = $1", [order.order_id]);
    expect(o.needs_attention).toBe(false);
    const audit = await q(t.pool, "select 1 from audit_log where action = 'withdrawal_received' and entity_id = $1", [w.id]);
    expect(audit).toHaveLength(1);
  });

  it("legt ook vast als ordernummer en e-mailadres niet passen (zonder dat te verraden) en meldt dat in beheer", async () => {
    const order = await webOrder("eigenaar@example.test");
    const sink: MailMessage[] = [];
    const res = await submitWithdrawal(values({ order_number: order.number, email: "iemand-anders@example.test" }), {
      db: t.db, mail: createSimulatedMail(sink), appUrl: "https://shop.test", clientKey: "ip2", limiter: limiter(),
    });
    expect(res.status).toBe("received");
    const list = await t.db.rpc<{ order_id: string | null; order_number: string }[]>("api_admin_withdrawals", { status: "received" });
    expect(list.find((w) => w.order_number === order.number && w.order_id === null)).toBeTruthy();
    expect(sink.some((m) => m.to === "iemand-anders@example.test")).toBe(true);
  });

  it("afhandelen in beheer wordt gelogd; rate limit en honeypot werken", async () => {
    const [w] = await q<{ id: string }>(t.pool, "select id from withdrawals limit 1");
    expect(await t.db.rpc("api_withdrawal_handle", { actor: ACTOR, id: w.id, status: "handled", note: "Retour ontvangen, terugbetaald" })).toEqual({ ok: true });
    const [row] = await q<{ status: string; handled_by: string }>(t.pool, "select status, handled_by from withdrawals where id = $1", [w.id]);
    expect(row).toEqual({ status: "handled", handled_by: ACTOR });
    expect(await q(t.pool, "select 1 from audit_log where action = 'withdrawal_handled' and entity_id = $1", [w.id])).toHaveLength(1);

    const one = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const deps = { db: t.db, mail: createSimulatedMail(), appUrl: "https://shop.test", clientKey: "ip3", limiter: one };
    expect((await submitWithdrawal(values({ order_number: "TO999999" }), deps)).status).toBe("received");
    expect((await submitWithdrawal(values({ order_number: "TO999998" }), deps)).status).toBe("rate_limited");
    expect((await submitWithdrawal({ ...values({ order_number: "TO999997" }), honeypot: "spam" }, deps)).status).toBe("ignored");
  });

  it("escapet klantinvoer in de bevestiging", () => {
    const m = renderWithdrawalAck(
      { id: "x", reference: "HR-1", order_number: "TO1", name: "<b>x</b>", email: "a@b.test", scope: "all", items: null, note: null, submitted_at: "2026-11-19T12:00:00Z" },
      null,
      "https://shop.test",
    );
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.text).toContain("19-11-2026 om 13:00:00");
  });
});

describe("e-mails en afrekenen met verkopergegevens", () => {
  it("orderbevestiging bevat verkoper, herroepingsinformatie en het modelformulier", async () => {
    const order = await webOrder();
    const o = await t.db.rpc<OrderForEmail>("api_order_for_email", { order_id: order.order_id });
    const m = renderEmail("order_confirmation", o, "https://shop.test");
    expect(m.html).toContain("Timber Online (Timber Services)");
    expect(m.html).toContain("KvK 88562700");
    expect(m.html).toContain("btw-id NL004626847B65");
    expect(m.html).toContain("https://shop.test/herroepen");
    expect(m.html).toContain("Modelformulier voor herroeping");
    expect(m.text).toContain("Totaal (incl. btw)");
    const shipped = renderEmail("shipped", { ...o, shipment: { carrier: "dhl", tracking_code: "X", tracking_url: null, status: "handed_over" } }, "https://shop.test");
    expect(shipped.text).toContain("Bedenktijd: 14 dagen");
  });

  it("tekst boven de betaalknop noemt betalingsverplichting, verkoper, voorwaarden en bedenktijd", () => {
    const m = checkoutSubmitMessage("Timber Online (Timber Services)", "https://shop.test");
    expect(m).toContain("bestelling met betalingsverplichting bij Timber Online (Timber Services)");
    expect(m).toContain("https://shop.test/info/voorwaarden");
    expect(m.length).toBeLessThanOrEqual(1200);
  });
});
