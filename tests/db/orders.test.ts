import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { componentOnHand, freshDb, productId, q, type TestDb } from "../helpers/db";

type CreateRes = {
  ok: boolean;
  error?: string;
  order_id: string;
  number: string;
  quote: { total_cents: number; discount_cents: number; lines: { discount_cents: number; sku: string }[] };
  shortages?: { name: string; needed: number; available: number }[];
};

let t: TestDb;
const P: Record<string, string> = {};
const ACTOR = "test:admin";

async function create(lines: [string, number][], extra: Record<string, unknown> = {}) {
  return t.db.rpc<CreateRes>("api_create_web_order", {
    lines: lines.map(([sku, qty]) => ({ product_id: P[sku], qty })),
    shipping_option: "tracked",
    ...extra,
  });
}
async function pay(orderId: string, extra: Record<string, unknown> = {}) {
  return t.db.rpc<{ ok: boolean; already: boolean; stock_status: string; late: boolean }>("api_mark_order_paid", {
    order_id: orderId,
    payment_intent_id: `pi_${orderId.slice(0, 8)}`,
    customer: { email: "klant@example.test", name: "Test Klant", street: "Teststraat", house_number: "1", postal_code: "1234 AB", city: "Teststad", country: "NL" },
    ...extra,
  });
}

beforeAll(async () => {
  t = await freshDb();
  for (const sku of [
    "TO-SP2-IP14-STD",
    "TO-CS-IP14-MS",
    "TO-BND-IP14-CS-SP2",
    "TO-BND-IP14-CS-SP1",
    "TO-SP2-IP12PM-PRV",
    "TO-SP2-IP15PL-PRV",
    "TO-SP2-IP15-PRV",
    "TO-SP2-IP12-STD",
    "TO-SP2-IP11-STD",
    "TO-SP2-IP13PM-PRV",
  ])
    P[sku] = await productId(t.pool, sku);
});
afterAll(async () => t.close());

describe("prijsberekening", () => {
  beforeEach(async () => {
    await t.pool.query("update discount_rules set active = false");
  });

  it("rekent een tweepack tegen de webprijs met gratis verzending", async () => {
    const quote = await t.db.rpc<{ ok: boolean; total_cents: number; shipping_cents: number; lines: { unit_price_cents: number }[] }>(
      "api_quote",
      { lines: [{ product_id: P["TO-SP2-IP15PL-PRV"], qty: 1 }], shipping_option: "tracked" },
    );
    expect(quote.ok).toBe(true);
    expect(quote.lines[0].unit_price_cents).toBe(2495);
    expect(quote.shipping_cents).toBe(0);
    expect(quote.total_cents).toBe(2495);
  });

  it("past staffelkorting (percentage) toe vanaf het ingestelde aantal op geselecteerde artikelen", async () => {
    await t.pool.query("update discount_rules set active = true where name = 'Vanaf 2 sets 10% korting'");
    const one = await t.db.rpc<{ discount_cents: number }>("api_quote", { lines: [{ product_id: P["TO-SP2-IP15-PRV"], qty: 1 }] });
    expect(one.discount_cents).toBe(0);
    const mixed = await t.db.rpc<{ discount_cents: number; total_cents: number }>("api_quote", {
      lines: [
        { product_id: P["TO-SP2-IP15-PRV"], qty: 1 },
        { product_id: P["TO-SP2-IP12-STD"], qty: 1 },
      ],
    });
    expect(mixed.discount_cents).toBe(200 + 200); // 10% van 1995 = 199,5 → 200 per stuk
    expect(mixed.total_cents).toBe(1995 * 2 - 400);
  });

  it("past staffelkorting (vast bedrag) toe en kiest per regel de beste korting zonder stapeling", async () => {
    await t.pool.query("update discount_rules set active = true where name = 'Vanaf 2 sets 10% korting'");
    const r = await t.db.rpc<{ ok: boolean; id: string }>("api_discount_save", {
      actor: ACTOR,
      name: "Vanaf 3 stuks €3 per stuk",
      min_qty: 3,
      discount_type: "fixed",
      value: 300,
      product_ids: [P["TO-SP2-IP15-PRV"]],
    });
    expect(r.ok).toBe(true);
    const quote = await t.db.rpc<{ discount_cents: number; lines: { discount_per_unit_cents: number }[] }>("api_quote", {
      lines: [{ product_id: P["TO-SP2-IP15-PRV"], qty: 3 }],
    });
    expect(quote.lines[0].discount_per_unit_cents).toBe(300);
    expect(quote.discount_cents).toBe(900);
    await t.db.rpc("api_discount_delete", { actor: ACTOR, id: r.id });
  });

  it("geeft bundels standaard geen extra staffelkorting", async () => {
    await t.pool.query("update discount_rules set active = true where name = 'Vanaf 2 sets 10% korting'");
    await t.pool.query(
      "insert into discount_rule_products (rule_id, product_id) select id, $1 from discount_rules where name = 'Vanaf 2 sets 10% korting'",
      [P["TO-BND-IP14-CS-SP2"]],
    );
    const quote = await t.db.rpc<{ lines: { sku: string; discount_cents: number; unit_price_cents: number }[] }>("api_quote", {
      lines: [{ product_id: P["TO-BND-IP14-CS-SP2"], qty: 2 }],
    });
    expect(quote.lines[0].discount_cents).toBe(0);
    expect(quote.lines[0].unit_price_cents).toBe(2995);
    await t.pool.query("delete from discount_rule_products where product_id = $1", [P["TO-BND-IP14-CS-SP2"]]);
  });

  it("weigert conceptartikelen en ongeldige aantallen", async () => {
    const r1 = await t.db.rpc<{ ok: boolean; errors: { code: string }[] }>("api_quote", { lines: [{ product_id: P["TO-SP2-IP11-STD"], qty: 1 }] });
    expect(r1.ok).toBe(false);
    expect(r1.errors[0].code).toBe("product_unavailable");
    const r2 = await t.db.rpc<{ ok: boolean; errors: { code: string }[] }>("api_quote", { lines: [{ product_id: P["TO-SP2-IP15-PRV"], qty: 0 }] });
    expect(r2.errors[0].code).toBe("invalid_qty");
  });

  it("weigert een uitgeschakelde verzendoptie (briefpost staat standaard uit)", async () => {
    const r = await t.db.rpc<{ ok: boolean; errors: { code: string }[] }>("api_quote", {
      lines: [{ product_id: P["TO-SP2-IP15-PRV"], qty: 1 }],
      shipping_option: "letter",
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("shipping_option_unavailable");
  });
});

describe("reserveren en gedeelde componentvoorraad", () => {
  it("reserveert componenten per stuk en slaat prijzen en kortingen op de orderregels op", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await create([["TO-SP2-IP15-PRV", 2]]);
    expect(r.ok).toBe(true);
    const after = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    expect(after.on_hand).toBe(before.on_hand);
    expect(after.reserved).toBe(before.reserved + 4);
    const lines = await q<{ unit_price_cents: number; qty: number; line_total_cents: number }>(
      t.pool,
      "select unit_price_cents, qty, line_total_cents from order_lines where order_id = $1",
      [r.order_id],
    );
    expect(lines).toEqual([{ unit_price_cents: 1995, qty: 2, line_total_cents: 3990 }]);
    await t.db.rpc("api_release_order", { order_id: r.order_id, status: "expired" });
  });

  it("laat sets en bundels samen nooit meer verkopen dan fysiek aanwezig is", async () => {
    // iPhone 14 normaal: 14 stuks. 7 tweepacks = 14 stuks; bundel vraagt nog 2 extra → tekort.
    const r = await create([
      ["TO-SP2-IP14-STD", 7],
      ["TO-BND-IP14-CS-SP2", 1],
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("insufficient_stock");
    expect(r.shortages?.[0]).toMatchObject({ needed: 16, available: 14 });
    const quote = await t.db.rpc<{ stock_ok: boolean; shortages: { needed: number }[] }>("api_quote", {
      lines: [
        { product_id: P["TO-SP2-IP14-STD"], qty: 7 },
        { product_id: P["TO-BND-IP14-CS-SP2"], qty: 1 },
      ],
    });
    expect(quote.stock_ok).toBe(false); // de winkelwagen toont het tekort al vóór afrekenen
    expect(quote.shortages[0].needed).toBe(16);
  });

  it("blokkeert het reserveren bij tekort over set + bundel", async () => {
    const r = await create([
      ["TO-SP2-IP14-STD", 6],
      ["TO-BND-IP14-CS-SP2", 1],
      ["TO-BND-IP14-CS-SP1", 1],
    ]);
    // 12 + 2 + 1 = 15 protectorstuks > 14
    expect(r.ok).toBe(false);
    expect(r.error).toBe("insufficient_stock");
    expect(r.shortages?.[0]).toMatchObject({ needed: 15, available: 14 });
    const ok = await create([
      ["TO-SP2-IP14-STD", 6],
      ["TO-BND-IP14-CS-SP2", 1],
    ]);
    expect(ok.ok).toBe(true);
    const bundleOnly = await create([["TO-BND-IP14-CS-SP1", 1]]);
    expect(bundleOnly.ok).toBe(false); // 0 protectors vrij
    await t.db.rpc("api_release_order", { order_id: ok.order_id, status: "expired" });
  });

  it("laat bij gelijktijdige reserveringen alleen toe wat fysiek beschikbaar is", async () => {
    // iPhone 12 Pro Max privacy: 5 stuks → maximaal 2 tweepacks
    const results = await Promise.all(Array.from({ length: 6 }, () => create([["TO-SP2-IP12PM-PRV", 1]])));
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(2);
    expect(results.filter((r) => r.error === "insufficient_stock")).toHaveLength(4);
    const s = await componentOnHand(t.pool, "C-SP-IP12PM-PRV");
    expect(s.reserved).toBe(4);
    expect(s.free).toBe(1);
    for (const r of ok) await t.db.rpc("api_release_order", { order_id: r.order_id, status: "expired" });
    expect((await componentOnHand(t.pool, "C-SP-IP12PM-PRV")).free).toBe(5);
  });
});

describe("betaalmeldingen", () => {
  it("boekt na betaling precies één keer af, ook bij herhaalde en gelijktijdige meldingen", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP13PM-PRV");
    const r = await create([["TO-SP2-IP13PM-PRV", 2]]);
    const results = await Promise.all([pay(r.order_id), pay(r.order_id), pay(r.order_id)]);
    expect(results.filter((x) => !x.already)).toHaveLength(1);
    expect(results.every((x) => x.stock_status === "committed")).toBe(true);
    const again = await pay(r.order_id);
    expect(again.already).toBe(true);
    const after = await componentOnHand(t.pool, "C-SP-IP13PM-PRV");
    expect(after.on_hand).toBe(before.on_hand - 4);
    expect(after.reserved).toBe(before.reserved);
    const [m] = await q<{ n: string }>(t.pool, "select count(*)::text n from stock_movements where order_id = $1", [r.order_id]);
    expect(Number(m.n)).toBe(1);
  });

  it("geeft voorraad vrij als de betaalpoging verloopt, en verwerkt een verloopmelding idempotent", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await create([["TO-SP2-IP15-PRV", 1]]);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).free).toBe(before.free - 2);
    const first = await t.db.rpc<{ changed: boolean }>("api_release_order", { order_id: r.order_id, status: "expired" });
    const second = await t.db.rpc<{ changed: boolean }>("api_release_order", { order_id: r.order_id, status: "expired" });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).free).toBe(before.free);
  });

  it("ruimt verlopen reserveringen op via de sweeper", async () => {
    const r = await create([["TO-SP2-IP15-PRV", 1]]);
    await t.pool.query("update orders set reserved_until = now() - interval '1 minute' where id = $1", [r.order_id]);
    await t.pool.query("update reservations set expires_at = now() - interval '1 minute' where order_id = $1", [r.order_id]);
    const res = await t.db.rpc<{ expired: number }>("api_expire_stale_orders", {});
    expect(res.expired).toBeGreaterThanOrEqual(1);
    const [o] = await q<{ payment_status: string; stock_status: string }>(t.pool, "select payment_status, stock_status from orders where id = $1", [r.order_id]);
    expect(o).toEqual({ payment_status: "expired", stock_status: "released" });
  });

  it("verwerkt een late betaling: wijst voorraad opnieuw toe als die er nog is", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await create([["TO-SP2-IP15-PRV", 1]]);
    await t.db.rpc("api_release_order", { order_id: r.order_id, status: "expired" });
    const paid = await pay(r.order_id);
    expect(paid.late).toBe(true);
    expect(paid.stock_status).toBe("committed");
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand - 2);
    const [o] = await q<{ needs_attention: boolean; attention_reason: string }>(t.pool, "select needs_attention, attention_reason from orders where id = $1", [r.order_id]);
    expect(o.needs_attention).toBe(true);
    expect(o.attention_reason).toMatch(/Late betaalbevestiging/);
  });

  it("maakt een tekort zichtbaar bij een late betaling zonder voorraad, en herstelt na correctie", async () => {
    // iPhone 12 Pro Max privacy: 5 stuks. Order A reserveert 2 tweepacks en verloopt; order B neemt ze.
    const a = await create([["TO-SP2-IP12PM-PRV", 2]]);
    await t.db.rpc("api_release_order", { order_id: a.order_id, status: "expired" });
    const b = await create([["TO-SP2-IP12PM-PRV", 2]]);
    expect(b.ok).toBe(true);
    await pay(b.order_id);
    const late = await pay(a.order_id);
    expect(late.stock_status).toBe("shortage");
    const [o] = await q<{ stock_status: string; needs_attention: boolean; attention_reason: string }>(
      t.pool,
      "select stock_status, needs_attention, attention_reason from orders where id = $1",
      [a.order_id],
    );
    expect(o.needs_attention).toBe(true);
    expect(o.attention_reason).toMatch(/Voorraadtekort/);
    expect((await componentOnHand(t.pool, "C-SP-IP12PM-PRV")).on_hand).toBe(1); // nooit negatief
    const overview = await t.db.rpc<{ attention: { number: string }[] }>("api_admin_overview", {});
    expect(overview.attention.map((x) => x.number)).toContain(a.number);
    // nieuwe levering geteld → opnieuw toewijzen
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: (await q<{ id: string }>(t.pool, "select id from components where code = 'C-SP-IP12PM-PRV'"))[0].id, mode: "delta", value: 4, reason: "Nalevering" });
    const retry = await t.db.rpc<{ stock_status: string }>("api_order_retry_stock", { actor: ACTOR, order_id: a.order_id });
    expect(retry.stock_status).toBe("committed");
    expect((await componentOnHand(t.pool, "C-SP-IP12PM-PRV")).on_hand).toBe(1);
  });

  it("markeert een afwijkend betaald bedrag", async () => {
    const r = await create([["TO-SP2-IP15-PRV", 1]]);
    await pay(r.order_id, { amount_total: 1 });
    const [o] = await q<{ attention_reason: string }>(t.pool, "select attention_reason from orders where id = $1", [r.order_id]);
    expect(o.attention_reason).toMatch(/wijkt af/);
  });
});

describe("annuleren, refunds en retouren", () => {
  it("annuleert een onbetaalde order en geeft de reservering vrij", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await create([["TO-SP2-IP15-PRV", 1]]);
    const c = await t.db.rpc<{ ok: boolean; refund_needed: boolean }>("api_order_cancel", { actor: ACTOR, order_id: r.order_id });
    expect(c.ok).toBe(true);
    expect(c.refund_needed).toBe(false);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).free).toBe(before.free);
  });

  it("annuleert een betaalde, niet-verzonden order en zet voorraad terug", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await create([["TO-SP2-IP15-PRV", 2]]);
    await pay(r.order_id);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand - 4);
    const c = await t.db.rpc<{ ok: boolean; restocked: boolean; refund_needed: boolean }>("api_order_cancel", { actor: ACTOR, order_id: r.order_id });
    expect(c).toMatchObject({ ok: true, restocked: true, refund_needed: true });
    const twice = await t.db.rpc<{ already: boolean }>("api_order_cancel", { actor: ACTOR, order_id: r.order_id });
    expect(twice.already).toBe(true);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand);
  });

  it("registreert refunds idempotent en werkt de betaalstatus bij", async () => {
    const r = await create([["TO-SP2-IP15-PRV", 1]]);
    await pay(r.order_id);
    const b1 = await t.db.rpc<{ ok: boolean; refund_id: string }>("api_refund_begin", { actor: ACTOR, order_id: r.order_id, amount_cents: 500, idempotency_key: "k1" });
    const b2 = await t.db.rpc<{ ok: boolean; duplicate: boolean }>("api_refund_begin", { actor: ACTOR, order_id: r.order_id, amount_cents: 500, idempotency_key: "k1" });
    expect(b2.duplicate).toBe(true);
    await t.db.rpc("api_refund_finish", { refund_id: b1.refund_id, ok: true, provider_refund_id: "re_1" });
    await t.db.rpc("api_refund_finish", { refund_id: b1.refund_id, ok: true, provider_refund_id: "re_1" });
    let [o] = await q<{ payment_status: string; refunded_cents: number }>(t.pool, "select payment_status, refunded_cents from orders where id = $1", [r.order_id]);
    expect(o).toEqual({ payment_status: "partially_refunded", refunded_cents: 500 });
    const tooMuch = await t.db.rpc<{ ok: boolean; error: string }>("api_refund_begin", { actor: ACTOR, order_id: r.order_id, amount_cents: 2000, idempotency_key: "k2" });
    expect(tooMuch.error).toBe("invalid_amount");
    const rest = await t.db.rpc<{ refund_id: string }>("api_refund_begin", { actor: ACTOR, order_id: r.order_id, amount_cents: 1495, idempotency_key: "k3" });
    await t.db.rpc("api_refund_finish", { refund_id: rest.refund_id, ok: true, provider_refund_id: "re_2" });
    [o] = await q(t.pool, "select payment_status, refunded_cents from orders where id = $1", [r.order_id]);
    expect(o).toEqual({ payment_status: "refunded", refunded_cents: 1995 });
  });

  it("laat de beheerder per retourregel kiezen tussen weer verkoopbaar en afboeken", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await create([["TO-SP2-IP15-PRV", 3]]);
    await pay(r.order_id);
    const [line] = await q<{ id: string }>(t.pool, "select id from order_lines where order_id = $1", [r.order_id]);
    const ret = await t.db.rpc<{ return_id: string }>("api_return_create", { actor: ACTOR, order_id: r.order_id, lines: [{ order_line_id: line.id, qty: 2 }] });
    await expect(
      t.db.rpc("api_return_create", { actor: ACTOR, order_id: r.order_id, lines: [{ order_line_id: line.id, qty: 2 }] }),
    ).rejects.toThrow(/return_qty_exceeds_order/);
    const [rl] = await q<{ id: string }>(t.pool, "select id from return_lines where return_id = $1", [ret.return_id]);
    await t.db.rpc("api_return_decide", { actor: ACTOR, return_line_id: rl.id, decision: "restock" });
    const again = await t.db.rpc<{ already: boolean }>("api_return_decide", { actor: ACTOR, return_line_id: rl.id, decision: "restock" });
    expect(again.already).toBe(true);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand - 6 + 4);
    const ret2 = await t.db.rpc<{ return_id: string }>("api_return_create", { actor: ACTOR, order_id: r.order_id, lines: [{ order_line_id: line.id, qty: 1 }] });
    const [rl2] = await q<{ id: string }>(t.pool, "select id from return_lines where return_id = $1", [ret2.return_id]);
    await t.db.rpc("api_return_decide", { actor: ACTOR, return_line_id: rl2.id, decision: "writeoff" });
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand - 6 + 4);
  });
});

describe("voorraadcorrecties en audit", () => {
  it("weigert negatieve voorraad en legt correcties vast met uitvoerder en tijdstip", async () => {
    const [c] = await q<{ id: string; on_hand: number }>(t.pool, "select id, on_hand from components where code = 'C-CS-IP13PM'");
    const neg = await t.db.rpc<{ ok: boolean; error: string }>("api_stock_correct", { actor: ACTOR, component_id: c.id, mode: "set", value: -1, reason: "test" });
    expect(neg.error).toBe("negative_stock");
    await expect(t.db.rpc("api_stock_correct", { component_id: c.id, mode: "set", value: 2, reason: "x" })).rejects.toThrow(/actor_required/);
    await expect(t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: c.id, mode: "set", value: 2, reason: "" })).rejects.toThrow(/reason_required/);
    const ok = await t.db.rpc<{ ok: boolean; on_hand: number }>("api_stock_correct", { actor: ACTOR, component_id: c.id, mode: "set", value: 2, reason: "Beschadigd" });
    expect(ok.on_hand).toBe(2);
    const [a] = await q<{ actor: string; at: Date; before: { on_hand: number }; after: { on_hand: number } }>(
      t.pool,
      "select actor, at, before, after from audit_log where action = 'stock_correction' and entity_id = $1 order by id desc limit 1",
      [c.id],
    );
    expect(a.actor).toBe(ACTOR);
    expect(a.before.on_hand).toBe(c.on_hand);
    expect(a.after.on_hand).toBe(2);
    expect(a.at).toBeInstanceOf(Date);
  });

  it("legt prijswijzigingen vast en laat voorraad ongemoeid", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = await t.db.rpc<{ ok: boolean; old_cents: number; new_cents: number }>("api_set_price", {
      actor: ACTOR,
      product_id: P["TO-SP2-IP15-PRV"],
      channel: "web",
      price_cents: 1795,
    });
    expect(r).toMatchObject({ ok: true, old_cents: 1995, new_cents: 1795 });
    expect(await componentOnHand(t.pool, "C-SP-IP15-PRV")).toEqual(before);
    const [a] = await q<{ n: string }>(t.pool, "select count(*)::text n from audit_log where action = 'price_change'");
    expect(Number(a.n)).toBeGreaterThan(0);
    await t.db.rpc("api_set_price", { actor: ACTOR, product_id: P["TO-SP2-IP15-PRV"], channel: "web", price_cents: 1995 });
  });
});
