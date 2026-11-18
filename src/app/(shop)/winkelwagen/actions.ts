"use server";
import { z } from "zod";
import { getCtx } from "@/server/services/runtime";
import { cancelCheckout, startCheckout } from "@/server/services/checkout";
import type { Quote } from "@/server/services/types";
import { productImageUrl } from "@/server/storage";

const Lines = z
  .array(z.object({ product_id: z.uuid(), qty: z.number().int().min(1).max(20) }))
  .min(1)
  .max(30);
const Option = z.string().regex(/^[a-z_]{2,20}$/);

export async function quoteAction(lines: unknown, shippingOption: unknown): Promise<Quote | { ok: false; errors: { code: string }[] }> {
  const l = Lines.safeParse(lines);
  const o = Option.safeParse(shippingOption);
  if (!l.success || !o.success) return { ok: false, errors: [{ code: "invalid_input" }] };
  const q = await getCtx().db.rpc<Quote>("api_quote", { lines: l.data, shipping_option: o.data });
  return { ...q, lines: (q.lines ?? []).map((x) => ({ ...x, image_path: productImageUrl(x.image_path) })) };
}

export async function checkoutAction(lines: unknown, shippingOption: unknown) {
  const l = Lines.safeParse(lines);
  const o = Option.safeParse(shippingOption);
  if (!l.success || !o.success) return { ok: false as const, message: "Je winkelwagen is ongeldig. Ververs de pagina." };
  const res = await startCheckout(getCtx(), { lines: l.data, shipping_option: o.data });
  if (!res.ok) return { ok: false as const, message: res.message };
  return { ok: true as const, url: res.url };
}

export async function cancelAction(orderId: unknown) {
  const id = z.uuid().safeParse(orderId);
  if (id.success) await cancelCheckout(getCtx(), id.data);
  return { ok: true };
}
