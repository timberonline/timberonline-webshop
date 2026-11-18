import type Stripe from "stripe";
import type { Ctx } from "./context";
import type { Quote } from "./types";

export type CheckoutInput = { lines: { product_id: string; qty: number }[]; shipping_option: string };
export type CheckoutResult =
  | { ok: true; url: string; order_id: string; number: string }
  | { ok: false; error: string; message: string; quote?: Quote; shortages?: unknown[] };

const MESSAGES: Record<string, string> = {
  payments_unavailable: "Afrekenen is tijdelijk niet beschikbaar.",
  quote_invalid: "Je winkelwagen bevat een artikel dat niet meer beschikbaar is.",
  insufficient_stock: "Er is niet genoeg voorraad voor je winkelwagen. Pas de aantallen aan.",
  stripe_error: "De betaalpagina kon niet worden geopend. Probeer het opnieuw.",
};

export async function startCheckout(ctx: Ctx, input: CheckoutInput): Promise<CheckoutResult> {
  if (!ctx.stripe) return { ok: false, error: "payments_unavailable", message: MESSAGES.payments_unavailable };
  await ctx.db.rpc("api_expire_stale_orders", { limit: 50 }).catch(() => undefined);

  const res = await ctx.db.rpc<{ ok: boolean; error?: string; order_id: string; number: string; quote: Quote; shortages?: unknown[] }>(
    "api_create_web_order",
    { lines: input.lines, shipping_option: input.shipping_option },
  );
  if (!res.ok) {
    const error = res.error ?? "quote_invalid";
    return { ok: false, error, message: MESSAGES[error] ?? MESSAGES.quote_invalid, quote: res.quote, shortages: res.shortages };
  }

  const q = res.quote;
  try {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      locale: "nl",
      client_reference_id: res.order_id,
      metadata: { order_id: res.order_id, order_number: res.number },
      payment_intent_data: { metadata: { order_id: res.order_id, order_number: res.number }, description: `Timber Online ${res.number}` },
      line_items: q.lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: "eur",
          unit_amount: l.unit_price_cents - l.discount_per_unit_cents,
          product_data: {
            name: l.title,
            metadata: { sku: l.sku },
            ...(l.discount_per_unit_cents ? { description: `Inclusief korting: ${l.discount_rule_name ?? "staffelkorting"}` } : {}),
          },
        },
      })),
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: q.shipping_option?.label ?? "Verzending",
            fixed_amount: { amount: q.shipping_cents, currency: "eur" },
          },
        },
      ],
      shipping_address_collection: { allowed_countries: ["NL", "BE"] },
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60, // Stripe eist ≥ 30 min; reservering loopt 35 min
      success_url: `${ctx.appUrl}/bestelling/bedankt?order=${res.order_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ctx.appUrl}/winkelwagen?geannuleerd=${res.order_id}`,
    };
    const types = process.env.STRIPE_PAYMENT_METHOD_TYPES?.split(",").map((s) => s.trim()).filter(Boolean);
    // Filter op de dynamisch bepaalde betaalmethoden (bijv. "ideal,klarna"); leeg = alles wat in het Stripe-dashboard aan staat.
    if (types?.length) params.allowed_payment_method_types = types as Stripe.Checkout.SessionCreateParams.AllowedPaymentMethodType[];
    const session = await ctx.stripe.checkout.sessions.create(params, { idempotencyKey: `checkout:${res.order_id}` });
    await ctx.db.rpc("api_attach_checkout_session", { order_id: res.order_id, session_id: session.id });
    if (!session.url) throw new Error("Stripe gaf geen checkout-URL terug");
    return { ok: true, url: session.url, order_id: res.order_id, number: res.number };
  } catch (e) {
    console.error("Checkout-sessie mislukt", (e as Error).message);
    await ctx.db.rpc("api_release_order", { order_id: res.order_id, status: "failed", actor: "system:checkout" });
    return { ok: false, error: "stripe_error", message: MESSAGES.stripe_error };
  }
}

/** Klant breekt af op de betaalpagina: sessie laten verlopen en reservering direct vrijgeven. */
export async function cancelCheckout(ctx: Ctx, orderId: string) {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return;
  const order = await ctx.db.rpc<{ payment_status: string; stripe_session_id: string | null } | null>("api_admin_order", { id: orderId });
  if (!order || order.payment_status !== "pending") return;
  if (ctx.stripe && order.stripe_session_id) {
    try {
      const s = await ctx.stripe.checkout.sessions.retrieve(order.stripe_session_id);
      if (s.status === "open") await ctx.stripe.checkout.sessions.expire(order.stripe_session_id);
      else return; // voltooid of al verlopen: webhook handelt het af
    } catch {
      return;
    }
  }
  await ctx.db.rpc("api_release_order", { order_id: orderId, status: "cancelled", actor: "system:checkout-cancel" });
}
