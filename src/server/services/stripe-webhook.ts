import type Stripe from "stripe";
import type { Ctx } from "./context";
import { normalizePostalCode, splitStreet } from "./address";
import { sendOrderEmail } from "./email";
import { processBolQueue } from "./bol-sync";

type SessionLike = Stripe.Checkout.Session & {
  collected_information?: { shipping_details?: { name?: string | null; address?: Stripe.Address | null } | null } | null;
  shipping_details?: { name?: string | null; address?: Stripe.Address | null } | null;
};

function customerFrom(session: SessionLike) {
  const ship = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
  const addr = ship?.address ?? session.customer_details?.address ?? null;
  const parts = splitStreet(addr?.line1, addr?.line2);
  return {
    email: session.customer_details?.email ?? null,
    name: ship?.name ?? session.customer_details?.name ?? null,
    phone: session.customer_details?.phone ?? null,
    street: parts.street,
    house_number: parts.house_number,
    address_extra: parts.address_extra,
    postal_code: normalizePostalCode(addr?.postal_code, addr?.country),
    city: addr?.city ?? null,
    country: addr?.country ?? null,
  };
}

function orderIdOf(session: Stripe.Checkout.Session) {
  return session.metadata?.order_id ?? session.client_reference_id ?? null;
}

export async function handleStripeEvent(ctx: Ctx, event: Stripe.Event): Promise<{ handled: boolean; detail?: string }> {
  await ctx.db.rpc("api_record_webhook_event", { id: event.id, source: "stripe", type: event.type });
  try {
    const result = await dispatch(ctx, event);
    await ctx.db.rpc("api_finish_webhook_event", { id: event.id, status: result.handled ? "processed" : "ignored" });
    return result;
  } catch (e) {
    await ctx.db.rpc("api_finish_webhook_event", { id: event.id, status: "failed", error: (e as Error).message }).catch(() => undefined);
    throw e;
  }
}

async function markPaid(ctx: Ctx, session: SessionLike) {
  const orderId = orderIdOf(session);
  if (!orderId) return { handled: false, detail: "geen order_id" };
  let paymentMethod: string | null = null;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (pi && ctx.stripe) {
    try {
      const intent = await ctx.stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] });
      const charge = intent.latest_charge as Stripe.Charge | null;
      paymentMethod = charge?.payment_method_details?.type ?? intent.payment_method_types?.[0] ?? null;
    } catch {
      paymentMethod = null;
    }
  }
  const res = await ctx.db.rpc<{ ok: boolean; already: boolean; stock_status: string; error?: string }>("api_mark_order_paid", {
    order_id: orderId,
    session_id: session.id,
    payment_intent_id: pi,
    payment_method: paymentMethod,
    amount_total: session.amount_total,
    customer: customerFrom(session),
    actor: "system:stripe",
  });
  if (!res.ok) return { handled: false, detail: res.error };
  if (res.stock_status === "committed") await sendOrderEmail(ctx, orderId, "order_confirmation");
  await processBolQueue(ctx).catch(() => undefined);
  return { handled: true, detail: res.already ? "al verwerkt" : res.stock_status };
}

async function dispatch(ctx: Ctx, event: Stripe.Event): Promise<{ handled: boolean; detail?: string }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as SessionLike;
      if (s.payment_status === "paid" || s.payment_status === "no_payment_required") return markPaid(ctx, s);
      return { handled: true, detail: "wacht op asynchrone betaling" };
    }
    case "checkout.session.async_payment_succeeded":
      return markPaid(ctx, event.data.object as SessionLike);
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const s = event.data.object as Stripe.Checkout.Session;
      const orderId = orderIdOf(s);
      await ctx.db.rpc("api_release_order", {
        ...(orderId ? { order_id: orderId } : { session_id: s.id }),
        status: event.type === "checkout.session.expired" ? "expired" : "failed",
        actor: "system:stripe",
      });
      await processBolQueue(ctx).catch(() => undefined);
      return { handled: true };
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!pi || !ctx.stripe) return { handled: false };
      const refunds = await ctx.stripe.refunds.list({ payment_intent: pi, limit: 100 });
      for (const r of refunds.data) {
        if (r.status !== "succeeded") continue;
        await ctx.db.rpc("api_refund_external", { payment_intent_id: pi, provider_refund_id: r.id, amount_cents: r.amount });
      }
      return { handled: true };
    }
    default:
      return { handled: false, detail: "genegeerd type" };
  }
}
