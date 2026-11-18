"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { getCtx } from "@/server/services/runtime";
import { confirmHandover, createLabel, prepareShipment, simulateCarrierEvent, uploadLabel } from "@/server/services/shipping";
import type { Carrier } from "@/server/integrations/carriers";
import { back, errText, str } from "../_lib";

function ret(fd: FormData) {
  const d = str(fd, "date");
  return `/beheer/verzendingen${/^\d{4}-\d{2}-\d{2}$/.test(d) ? `?date=${d}` : ""}`;
}

export async function prepareAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const carrier = (str(fd, "carrier") || undefined) as Carrier | undefined;
    const res = (await prepareShipment(getCtx(), s.actor, str(fd, "order_id"), carrier, fd.get("override") === "on")) as {
      ok: boolean;
      message?: string;
      error?: string;
      label?: { ok: boolean; message?: string; reuse?: boolean };
    };
    if (!res.ok) msg = { fout: res.message ?? res.error };
    else if (res.label && !res.label.ok) msg = { fout: `Zending aangemaakt, label mislukt: ${res.label.message}` };
    else msg = { ok: res.label?.reuse ? "Bestaand label hergebruikt" : "Label klaar" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/verzendingen");
  back(ret(fd), msg);
}

export async function relabelAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const res = await createLabel(getCtx(), s.actor, str(fd, "shipment_id"));
    msg = res.ok ? { ok: res.reuse ? "Bestaand label hergebruikt" : "Label klaar" } : { fout: res.message ?? res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/verzendingen");
  back(ret(fd), msg);
}

export async function uploadLabelAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Kies een labelbestand");
    if (file.size > 10 * 1024 * 1024) throw new Error("Bestand is groter dan 10 MB");
    const res = (await uploadLabel(getCtx(), s.actor, str(fd, "shipment_id"), { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }, {
      code: str(fd, "tracking_code"),
      url: str(fd, "tracking_url"),
    })) as { ok: boolean; message?: string; error?: string };
    msg = res.ok ? { ok: "Label geüpload" } : { fout: res.message ?? res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/verzendingen");
  back(ret(fd), msg);
}

export async function trackingAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const res = await getCtx().db.rpc<{ ok: boolean; error?: string }>("api_shipment_set_tracking", {
      actor: s.actor,
      shipment_id: str(fd, "shipment_id"),
      tracking_code: str(fd, "tracking_code"),
      tracking_url: str(fd, "tracking_url"),
    });
    msg = res.ok ? { ok: "Trackingcode opgeslagen" } : { fout: res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/verzendingen");
  back(ret(fd), msg);
}

export async function handoverAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const res = await confirmHandover(getCtx(), s.actor, str(fd, "shipment_id"));
    msg = res.ok ? { ok: res.first_handover ? "Overdracht bevestigd; klant en bol worden geïnformeerd" : "Was al overgedragen" } : { fout: res.message ?? res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/verzendingen");
  back(ret(fd), msg);
}

export async function simulateAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const res = (await simulateCarrierEvent(getCtx(), s.actor, str(fd, "shipment_id"), str(fd, "status"))) as { ok: boolean; message?: string; error?: string };
    msg = res.ok ? { ok: "Gesimuleerde vervoerdersstatus verwerkt" } : { fout: res.message ?? res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/verzendingen");
  back(ret(fd), msg);
}

export async function cancelShipmentAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.shipping);
    const res = await getCtx().db.rpc<{ ok: boolean; error?: string }>("api_shipment_cancel", { actor: s.actor, shipment_id: str(fd, "shipment_id") });
    msg = res.ok ? { ok: "Zending geannuleerd; kies opnieuw een vervoerder" } : { fout: res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/verzendingen");
  back(ret(fd), msg);
}
