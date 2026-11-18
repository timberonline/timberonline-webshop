import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { getCtx } from "@/server/services/runtime";
import { handleStripeEvent } from "@/server/services/stripe-webhook";

export async function POST(request: Request) {
  const ctx = getCtx();
  const secret = env.stripeWebhookSecret();
  const signature = request.headers.get("stripe-signature");
  if (!ctx.stripe || !secret || !signature) return NextResponse.json({ error: "niet geconfigureerd" }, { status: 400 });
  const body = await request.text();
  let event;
  try {
    event = await ctx.stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "ongeldige handtekening" }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(ctx, event);
    return NextResponse.json({ received: true, ...result });
  } catch (e) {
    console.error("Stripe-webhook mislukt", event.type, (e as Error).message);
    return NextResponse.json({ error: "verwerking mislukt" }, { status: 500 });
  }
}
