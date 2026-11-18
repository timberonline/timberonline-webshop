"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { getCtx } from "@/server/services/runtime";
import { processBolQueue } from "@/server/services/bol-sync";
import { back, errText, str } from "../_lib";

export async function correctStockAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    const value = Number(str(fd, "value"));
    if (!Number.isInteger(value)) throw new Error("Vul een geheel aantal in");
    const res = await getCtx().db.rpc<{ ok: boolean; error?: string; on_hand: number; warning?: string; unchanged?: boolean }>("api_stock_correct", {
      actor: s.actor,
      component_id: str(fd, "component_id"),
      mode: str(fd, "mode") === "set" ? "set" : "delta",
      value,
      reason: str(fd, "reason"),
    });
    await processBolQueue(getCtx()).catch(() => undefined);
    msg = res.ok
      ? { ok: res.unchanged ? "Ongewijzigd" : `Nieuwe voorraad: ${res.on_hand} stuks${res.warning ? ` — let op: ${res.warning}` : ""}` }
      : { fout: res.error === "negative_stock" ? "Voorraad kan niet negatief worden" : res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/voorraad");
  back("/beheer/voorraad", msg);
}
