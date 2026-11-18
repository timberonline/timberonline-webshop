"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { parseEuroToCents } from "@/lib/format";
import { getCtx } from "@/server/services/runtime";
import { back, errText, str } from "../_lib";

export async function saveDiscountAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    const type = str(fd, "discount_type") === "fixed" ? "fixed" : "percent";
    const value = type === "fixed" ? parseEuroToCents(str(fd, "value")) : Number(str(fd, "value"));
    if (!value || value <= 0) throw new Error("Ongeldige korting");
    const minQty = Number(str(fd, "min_qty"));
    if (!Number.isInteger(minQty) || minQty < 1) throw new Error("Ongeldig minimumaantal");
    const productIds = fd.getAll("product_ids").map(String);
    if (productIds.length === 0) throw new Error("Kies minimaal één artikel");
    await getCtx().db.rpc("api_discount_save", {
      actor: s.actor,
      id: str(fd, "id") || undefined,
      name: str(fd, "name"),
      min_qty: minQty,
      discount_type: type,
      value,
      active: fd.get("active") === "on",
      starts_at: str(fd, "starts_at"),
      ends_at: str(fd, "ends_at"),
      product_ids: productIds,
    });
    msg = { ok: "Actie opgeslagen" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/acties");
  back("/beheer/acties", msg);
}

export async function deleteDiscountAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    await getCtx().db.rpc("api_discount_delete", { actor: s.actor, id: str(fd, "id") });
    msg = { ok: "Actie verwijderd" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/acties");
  back("/beheer/acties", msg);
}
