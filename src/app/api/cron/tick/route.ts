import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { getCtx } from "@/server/services/runtime";
import { pollBolOrders, processBolQueue, processOutbox } from "@/server/services/bol-sync";
import { sendOrderEmail } from "@/server/services/email";

function authorized(request: Request) {
  const secret = env.cronSecret();
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Periodiek onderhoud: verlopen reserveringen, bol-wachtrij, verzendbevestigingen naar bol, bol-orders ophalen. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ctx = getCtx();
  const expired = await ctx.db.rpc<{ expired: number }>("api_expire_stale_orders", { limit: 200 });
  const bol = await processBolQueue(ctx, { limit: 50 });
  const outbox = await processOutbox(ctx);
  const imported = ctx.bol.mode === "live" ? await pollBolOrders(ctx) : [];
  const retry = await ctx.db.rpc<{ order_id: string; kind: "order_confirmation" | "shipped" }[]>("api_email_retry_list", {});
  for (const m of retry) await sendOrderEmail(ctx, m.order_id, m.kind);
  return NextResponse.json({ expired: expired.expired, bol: bol.length, outbox: outbox.length, imported: imported.length, mails: retry.length });
}
