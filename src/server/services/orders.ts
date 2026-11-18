import { randomUUID } from "node:crypto";
import type { Ctx } from "./context";
import { sendOrderEmail } from "./email";
import { processBolQueue } from "./bol-sync";

export async function refundOrder(ctx: Ctx, actor: string, orderId: string, amountCents: number, reason?: string, key: string = randomUUID()) {
  const begin = await ctx.db.rpc<{ ok: boolean; error?: string; message?: string; duplicate?: boolean; refund_id: string; payment_intent_id: string; max_cents?: number }>(
    "api_refund_begin",
    { actor, order_id: orderId, amount_cents: amountCents, reason, idempotency_key: key },
  );
  if (!begin.ok) return begin;
  if (begin.duplicate) return { ok: true, duplicate: true };
  if (!ctx.stripe) {
    await ctx.db.rpc("api_refund_finish", { refund_id: begin.refund_id, ok: false, error: "Stripe niet geconfigureerd" });
    return { ok: false, error: "stripe_unavailable", message: "Stripe is niet geconfigureerd" };
  }
  try {
    const refund = await ctx.stripe.refunds.create(
      { payment_intent: begin.payment_intent_id, amount: amountCents, metadata: { order_id: orderId } },
      { idempotencyKey: `refund:${key}` },
    );
    const ok = refund.status === "succeeded" || refund.status === "pending";
    await ctx.db.rpc("api_refund_finish", { refund_id: begin.refund_id, ok, provider_refund_id: refund.id, error: ok ? null : refund.status });
    return { ok, status: refund.status };
  } catch (e) {
    await ctx.db.rpc("api_refund_finish", { refund_id: begin.refund_id, ok: false, error: (e as Error).message });
    return { ok: false, error: "stripe_error", message: (e as Error).message };
  }
}

export async function cancelOrder(ctx: Ctx, actor: string, orderId: string, refund: boolean) {
  const res = await ctx.db.rpc<{ ok: boolean; error?: string; message?: string; refund_needed?: boolean; already?: boolean }>("api_order_cancel", {
    actor,
    order_id: orderId,
  });
  await processBolQueue(ctx).catch(() => undefined);
  if (!res.ok || !refund || !res.refund_needed) return res;
  const o = await ctx.db.rpc<{ total_cents: number; refunded_cents: number }>("api_admin_order", { id: orderId });
  const r = await refundOrder(ctx, actor, orderId, o.total_cents - o.refunded_cents, "Annulering", `cancel:${orderId}`);
  return { ...res, refund: r };
}

export async function retryStock(ctx: Ctx, actor: string, orderId: string) {
  const res = await ctx.db.rpc<{ ok: boolean; stock_status?: string; error?: string }>("api_order_retry_stock", { actor, order_id: orderId });
  if (res.ok && res.stock_status === "committed") await sendOrderEmail(ctx, orderId, "order_confirmation");
  await processBolQueue(ctx).catch(() => undefined);
  return res;
}
