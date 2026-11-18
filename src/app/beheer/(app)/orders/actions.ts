"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { parseEuroToCents } from "@/lib/format";
import { getCtx } from "@/server/services/runtime";
import { cancelOrder, refundOrder, retryStock } from "@/server/services/orders";
import { sendOrderEmail } from "@/server/services/email";
import { processBolQueue } from "@/server/services/bol-sync";
import { back, errText, str } from "../_lib";

const path = (id: string) => `/beheer/orders/${id}`;

export async function cancelOrderAction(fd: FormData) {
  const id = str(fd, "order_id");
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.orders);
    const res = (await cancelOrder(getCtx(), s.actor, id, fd.get("refund") === "on")) as { ok: boolean; message?: string; error?: string; refund?: { ok: boolean; message?: string } };
    msg = res.ok
      ? { ok: res.refund ? (res.refund.ok ? "Order geannuleerd en terugbetaald" : `Order geannuleerd; refund mislukt: ${res.refund.message}`) : "Order geannuleerd" }
      : { fout: res.message ?? res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath(path(id));
  back(path(id), msg);
}

export async function refundAction(fd: FormData) {
  const id = str(fd, "order_id");
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.orders);
    const cents = parseEuroToCents(str(fd, "amount"));
    if (!cents) throw new Error("Ongeldig bedrag");
    const res = (await refundOrder(getCtx(), s.actor, id, cents, str(fd, "reason") || undefined, str(fd, "key") || undefined)) as { ok: boolean; message?: string; error?: string; duplicate?: boolean };
    msg = res.ok ? { ok: res.duplicate ? "Refund was al aangevraagd" : "Refund aangemaakt" } : { fout: res.message ?? res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath(path(id));
  back(path(id), msg);
}

export async function retryStockAction(fd: FormData) {
  const id = str(fd, "order_id");
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.orders);
    const res = await retryStock(getCtx(), s.actor, id);
    msg = res.ok ? { ok: res.stock_status === "committed" ? "Voorraad toegewezen" : "Nog steeds tekort" } : { fout: res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath(path(id));
  back(path(id), msg);
}

export async function createReturnAction(fd: FormData) {
  const id = str(fd, "order_id");
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.orders);
    const lines = [...fd.entries()]
      .filter(([k]) => k.startsWith("ret_"))
      .map(([k, v]) => ({ order_line_id: k.slice(4), qty: Number(v) || 0 }))
      .filter((l) => l.qty > 0);
    await getCtx().db.rpc("api_return_create", { actor: s.actor, order_id: id, lines, note: str(fd, "note") });
    msg = { ok: "Retour geregistreerd. Beslis per regel of de artikelen weer verkoopbaar zijn." };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath(path(id));
  back(path(id), msg);
}

export async function decideReturnAction(fd: FormData) {
  const id = str(fd, "order_id");
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.orders);
    const decision = str(fd, "decision");
    await getCtx().db.rpc("api_return_decide", { actor: s.actor, return_line_id: str(fd, "return_line_id"), decision });
    await processBolQueue(getCtx()).catch(() => undefined);
    msg = { ok: decision === "restock" ? "Teruggeboekt naar voorraad" : "Afgeboekt (niet verkoopbaar)" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath(path(id));
  back(path(id), msg);
}

export async function updateAddressAction(fd: FormData) {
  const id = str(fd, "order_id");
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const res = await getCtx().db.rpc<{ ok: boolean; message?: string; error?: string }>("api_order_update_address", {
      actor: s.actor,
      order_id: id,
      name: str(fd, "name"),
      street: str(fd, "street"),
      house_number: str(fd, "house_number"),
      address_extra: str(fd, "address_extra"),
      postal_code: str(fd, "postal_code"),
      city: str(fd, "city"),
      country: str(fd, "country"),
    });
    msg = res.ok ? { ok: "Adres bijgewerkt" } : { fout: res.message ?? res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath(path(id));
  back(path(id), msg);
}

export async function resendEmailAction(fd: FormData) {
  const id = str(fd, "order_id");
  let msg: { ok?: string; fout?: string };
  try {
    await requireAdmin(ROLES.orders);
    const kind = str(fd, "kind") === "shipped" ? "shipped" : "order_confirmation";
    const res = await sendOrderEmail(getCtx(), id, kind);
    msg = res.sent ? { ok: "E-mail verstuurd" } : { fout: `Niet verstuurd: ${res.reason}` };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath(path(id));
  back(path(id), msg);
}
