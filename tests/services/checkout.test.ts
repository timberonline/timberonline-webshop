import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutEvent, fakeStripe, paidSession, testCtx } from "../helpers/ctx";
import { componentOnHand, freshDb, productId, q, type TestDb } from "../helpers/db";
import { cancelCheckout, startCheckout } from "@/server/services/checkout";
import { handleStripeEvent } from "@/server/services/stripe-webhook";
import { cancelOrder, refundOrder } from "@/server/services/orders";
import { renderEmail } from "@/server/services/email";

let t: TestDb;
let ip15: string;
let bundle: string;
const ACTOR = "test:admin";

beforeAll(async () => {
  t = await freshDb();
  ip15 = await productId(t.pool, "TO-SP2-IP15-PRV");
  bundle = await productId(t.pool, "TO-BND-IP14-CS-SP2");
});
afterAll(async () => t.close());

describe("gastcheckout met Stripe (nep-Stripe, testgegevens)", () => {
  it("reserveert, maakt een Checkout-sessie met korting en verzendkosten, en koppelt de sessie", async () => {
    await t.pool.query("update discount_rules set active = true where name = 'Vanaf 2 sets 10% korting'");
    const { stripe, state } = fakeStripe();
    const { ctx } = testCtx(t.db, { stripe });
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 2 }], shipping_option: "tracked" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const session = [...state.sessions.values()][0] as {
      line_items: { quantity: number; price_data: { unit_amount: number } }[];
      shipping_options: { shipping_rate_data: { fixed_amount: { amount: number } } }[];
      expires_at: number;
      metadata: { order_id: string };
    };
    expect(session.line_items[0]).toMatchObject({ quantity: 2, price_data: { unit_amount: 1995 - 200 } });
    expect(session.shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(0);
    expect(session.metadata.order_id).toBe(res.order_id);
    expect(session.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(29 * 60);
    expect(state.calls[0]).toBe(`create:checkout:${res.order_id}`);
    const [o] = await q<{ stripe_session_id: string; payment_status: string; discount_cents: number }>(
      t.pool,
      "select stripe_session_id, payment_status, discount_cents from orders where id = $1",
      [res.order_id],
    );
    expect(o).toMatchObject({ payment_status: "pending", discount_cents: 400 });
    expect(o.stripe_session_id).toMatch(/^cs_test_/);
    await t.pool.query("update discount_rules set active = false");
  });

  it("geeft de reservering vrij als Stripe de sessie niet kan maken", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const { stripe, state } = fakeStripe();
    state.failCreate = true;
    const { ctx } = testCtx(t.db, { stripe });
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 1 }], shipping_option: "tracked" });
    expect(res.ok).toBe(false);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).free).toBe(before.free);
  });

  it("weigert afrekenen zonder Stripe-configuratie", async () => {
    const { ctx } = testCtx(t.db, { stripe: null });
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 1 }], shipping_option: "tracked" });
    expect(res).toMatchObject({ ok: false, error: "payments_unavailable" });
  });

  it("verwerkt betaalmelding één keer, stuurt één bevestiging en slaat het adres gesplitst op", async () => {
    const { stripe } = fakeStripe();
    const { ctx, sink } = testCtx(t.db, { stripe });
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 1 }], shipping_option: "tracked" });
    if (!res.ok) throw new Error(res.message);
    const [{ stripe_session_id: sid }] = await q<{ stripe_session_id: string }>(t.pool, "select stripe_session_id from orders where id = $1", [res.order_id]);
    const event = checkoutEvent("checkout.session.completed", paidSession(res.order_id, sid, 1995));
    await handleStripeEvent(ctx, event);
    await handleStripeEvent(ctx, event); // herhaalde melding
    await handleStripeEvent(ctx, checkoutEvent("checkout.session.completed", paidSession(res.order_id, sid, 1995))); // ander event-id, zelfde betaling
    expect(sink.filter((m) => m.subject.includes(res.number))).toHaveLength(1);
    expect(sink[0].to).toBe("klant@example.test");
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand - 2);
    const [o] = await q<{ ship_street: string; ship_house_number: string; ship_postal_code: string; payment_method: string }>(
      t.pool,
      "select ship_street, ship_house_number, ship_postal_code, payment_method from orders where id = $1",
      [res.order_id],
    );
    expect(o).toEqual({ ship_street: "Teststraat", ship_house_number: "12A", ship_postal_code: "1234 AB", payment_method: "ideal" });
    const [ev] = await q<{ attempts: number; status: string }>(t.pool, "select attempts, status from webhook_events where id = $1", [event.id]);
    expect(ev).toEqual({ attempts: 2, status: "processed" });
  });

  it("geeft voorraad vrij bij een verlopen sessie en verwerkt daarna een late asynchrone betaling", async () => {
    const { stripe } = fakeStripe();
    const { ctx, sink } = testCtx(t.db, { stripe });
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 1 }], shipping_option: "tracked" });
    if (!res.ok) throw new Error(res.message);
    const [{ stripe_session_id: sid }] = await q<{ stripe_session_id: string }>(t.pool, "select stripe_session_id from orders where id = $1", [res.order_id]);
    await handleStripeEvent(ctx, checkoutEvent("checkout.session.expired", { id: sid, metadata: { order_id: res.order_id } }));
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).free).toBe(before.free);
    await handleStripeEvent(ctx, checkoutEvent("checkout.session.async_payment_succeeded", paidSession(res.order_id, sid, 1995)));
    const [o] = await q<{ payment_status: string; stock_status: string; needs_attention: boolean }>(
      t.pool,
      "select payment_status, stock_status, needs_attention from orders where id = $1",
      [res.order_id],
    );
    expect(o).toEqual({ payment_status: "paid", stock_status: "committed", needs_attention: true });
    expect(sink).toHaveLength(1);
  });

  it("wacht bij een nog niet betaalde (asynchrone) afronding en boekt dan nog niets af", async () => {
    const { stripe } = fakeStripe();
    const { ctx } = testCtx(t.db, { stripe });
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 1 }], shipping_option: "tracked" });
    if (!res.ok) throw new Error(res.message);
    const [{ stripe_session_id: sid }] = await q<{ stripe_session_id: string }>(t.pool, "select stripe_session_id from orders where id = $1", [res.order_id]);
    const r = await handleStripeEvent(ctx, checkoutEvent("checkout.session.completed", paidSession(res.order_id, sid, 1995, { payment_status: "unpaid" })));
    expect(r.detail).toMatch(/asynchrone/);
    const [o] = await q<{ payment_status: string }>(t.pool, "select payment_status from orders where id = $1", [res.order_id]);
    expect(o.payment_status).toBe("pending");
    await handleStripeEvent(ctx, checkoutEvent("checkout.session.async_payment_failed", { id: sid, metadata: { order_id: res.order_id } }));
    const [o2] = await q<{ payment_status: string; stock_status: string }>(t.pool, "select payment_status, stock_status from orders where id = $1", [res.order_id]);
    expect(o2).toEqual({ payment_status: "failed", stock_status: "released" });
  });

  it("laat een klant de betaling afbreken: sessie verloopt en reservering komt direct vrij", async () => {
    const { stripe, state } = fakeStripe();
    const { ctx } = testCtx(t.db, { stripe });
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 1 }], shipping_option: "tracked" });
    if (!res.ok) throw new Error(res.message);
    await cancelCheckout(ctx, res.order_id);
    expect(state.calls.some((c) => c.startsWith("expire:"))).toBe(true);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).free).toBe(before.free);
  });

  it("verkoopt een bundel uit dezelfde componentvoorraad als losse artikelen", async () => {
    const { stripe } = fakeStripe();
    const { ctx } = testCtx(t.db, { stripe });
    const protBefore = await componentOnHand(t.pool, "C-SP-IP14-STD");
    const caseBefore = await componentOnHand(t.pool, "C-CS-IP14");
    const res = await startCheckout(ctx, { lines: [{ product_id: bundle, qty: 1 }], shipping_option: "tracked" });
    if (!res.ok) throw new Error(res.message);
    const [{ stripe_session_id: sid }] = await q<{ stripe_session_id: string }>(t.pool, "select stripe_session_id from orders where id = $1", [res.order_id]);
    await handleStripeEvent(ctx, checkoutEvent("checkout.session.completed", paidSession(res.order_id, sid, 2995)));
    expect((await componentOnHand(t.pool, "C-SP-IP14-STD")).on_hand).toBe(protBefore.on_hand - 2);
    expect((await componentOnHand(t.pool, "C-CS-IP14")).on_hand).toBe(caseBefore.on_hand - 1);
  });
});

describe("refunds en annuleringen via Stripe", () => {
  it("maakt één refund per idempotentiesleutel en annuleert met volledige terugbetaling", async () => {
    const { stripe, state } = fakeStripe();
    const { ctx } = testCtx(t.db, { stripe });
    const res = await startCheckout(ctx, { lines: [{ product_id: ip15, qty: 1 }], shipping_option: "tracked" });
    if (!res.ok) throw new Error(res.message);
    const [{ stripe_session_id: sid }] = await q<{ stripe_session_id: string }>(t.pool, "select stripe_session_id from orders where id = $1", [res.order_id]);
    await handleStripeEvent(ctx, checkoutEvent("checkout.session.completed", paidSession(res.order_id, sid, 1995)));
    const r1 = await refundOrder(ctx, ACTOR, res.order_id, 500, "deels", "key-1");
    const r2 = await refundOrder(ctx, ACTOR, res.order_id, 500, "deels", "key-1");
    expect(r1.ok).toBe(true);
    expect((r2 as { duplicate?: boolean }).duplicate).toBe(true);
    expect(state.refunds).toHaveLength(1);
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const c = (await cancelOrder(ctx, ACTOR, res.order_id, true)) as { ok: boolean; refund?: { ok: boolean } };
    expect(c.ok).toBe(true);
    expect(c.refund?.ok).toBe(true);
    expect(state.refunds.map((r) => r.amount)).toEqual([500, 1495]);
    expect((await componentOnHand(t.pool, "C-SP-IP15-PRV")).on_hand).toBe(before.on_hand + 2);
    const [o] = await q<{ payment_status: string; fulfillment_status: string }>(t.pool, "select payment_status, fulfillment_status from orders where id = $1", [res.order_id]);
    expect(o).toEqual({ payment_status: "refunded", fulfillment_status: "cancelled" });
    // refund die Stripe als event terugmeldt wordt niet dubbel geteld
    await handleStripeEvent(ctx, checkoutEvent("charge.refunded", { payment_intent: `pi_${res.order_id.slice(0, 8)}` }));
    const [o2] = await q<{ refunded_cents: number }>(t.pool, "select refunded_cents from orders where id = $1", [res.order_id]);
    expect(o2.refunded_cents).toBe(1995);
  });
});

describe("e-mailinhoud", () => {
  it("escapet klantgegevens en toont totaal, korting en trackingbelofte", () => {
    const mail = renderEmail("order_confirmation", {
      id: "x", number: "TO100001", channel: "web", email: "a@b.test", customer_name: "<script>x</script>",
      subtotal_cents: 3990, discount_cents: 400, shipping_cents: 0, total_cents: 3590, delivery_promise: "Binnen 1–3 werkdagen",
      shipping_option: "tracked", tracking_promised: true, stock_status: "committed",
      address: { street: "Teststraat", house_number: "1", extra: null, postal_code: "1234 AB", city: "Teststad", country: "NL" },
      lines: [{ title: "Privacy-screenprotector iPhone 15", sku: "TO-SP2-IP15-PRV", qty: 2, unit_price_cents: 1995, discount_cents: 400, line_total_cents: 3590 }],
      shipment: null,
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html.replace(/\u00a0/g, " ")).toContain("€ 35,90");
    expect(mail.html).toContain("track &amp; trace");
  });
});
