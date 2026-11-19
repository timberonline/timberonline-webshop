"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { getCtx } from "@/server/services/runtime";
import { sendWithdrawalAck } from "@/server/services/withdrawal";
import { back, errText, str } from "../_lib";

export async function handleWithdrawalAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.orders);
    const status = str(fd, "status");
    const r = await getCtx().db.rpc<{ ok: boolean; error?: string }>("api_withdrawal_handle", { actor: s.actor, id: str(fd, "id"), status, note: str(fd, "note") });
    if (!r.ok) throw new Error(r.error ?? "Opslaan mislukt");
    msg = { ok: status === "received" ? "Herroeping weer open gezet" : "Herroeping bijgewerkt" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/herroepingen");
  back("/beheer/herroepingen", msg);
}

/** Ontvangstbevestiging opnieuw proberen als die eerder mislukte (verstuurt hooguit één keer). */
export async function retryWithdrawalAckAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    await requireAdmin(ROLES.orders);
    const ctx = getCtx();
    const sent = await sendWithdrawalAck({ db: ctx.db, mail: ctx.mail, appUrl: ctx.appUrl }, str(fd, "id"));
    msg = sent ? { ok: "Ontvangstbevestiging verstuurd" } : { fout: "Niet verstuurd (al verstuurd, bezig of mislukt)" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/herroepingen");
  back("/beheer/herroepingen", msg);
}
