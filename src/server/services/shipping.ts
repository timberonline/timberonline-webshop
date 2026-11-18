import { randomBytes } from "node:crypto";
import type { Ctx } from "./context";
import { imageToPdf, mergePdfs, type Address } from "../pdf/labels";
import { trackingUrl, type Carrier } from "../integrations/carriers";
import { sendOrderEmail } from "./email";
import { processOutbox } from "./bol-sync";

type Prep = { ok: boolean; error?: string; message?: string; shipment_id: string; carrier: Carrier; label_status: string; address_problems: string[] };
type Claim = {
  ok: boolean;
  error?: string;
  message?: string;
  reuse?: boolean;
  label_path?: string;
  token?: string;
  problems?: string[];
  shipment?: { id: string; carrier: Carrier; weight_g: number | null; ship_date: string };
  order?: Address & { number: string; channel: string; lines: { sku: string; qty: number }[] };
  sender?: Address | null;
};
type StatusResult = { ok: boolean; error?: string; message?: string; first_handover?: boolean; send_shipped_email?: boolean; order_id?: string; channel?: string; duplicate?: boolean };

/** Kiest de vervoerder en maakt direct het label (voorbeeldlabel in testmodus, adreslabel voor briefpost). */
export async function prepareShipment(ctx: Ctx, actor: string, orderId: string, carrier?: Carrier, overrideTracking = false) {
  const prep = await ctx.db.rpc<Prep>("api_shipment_prepare", {
    actor,
    order_id: orderId,
    ...(carrier ? { carrier } : {}),
    override_tracking: overrideTracking,
  });
  if (!prep.ok) return prep;
  if (prep.label_status === "ready") return { ...prep, label: { ok: true, reuse: true } };
  const label = await createLabel(ctx, actor, prep.shipment_id);
  return { ...prep, label };
}

export async function createLabel(ctx: Ctx, actor: string, shipmentId: string) {
  const claim = await ctx.db.rpc<Claim>("api_label_claim", { shipment_id: shipmentId });
  if (!claim.ok) return { ok: false, error: claim.error, message: claim.message ?? claim.problems?.join(", ") };
  if (claim.reuse) return { ok: true, reuse: true, label_path: claim.label_path };
  const s = claim.shipment!;
  const o = claim.order!;
  try {
    const res = await ctx.carriers.createLabel({
      carrier: s.carrier,
      orderNumber: o.number,
      shipDate: s.ship_date,
      weightG: s.weight_g,
      to: o,
      from: claim.sender ?? null,
      lines: o.lines,
    });
    const key = `${s.ship_date}/${shipmentId}-${randomBytes(4).toString("hex")}.pdf`;
    await ctx.storage.put("shipping-labels", key, res.pdf, "application/pdf");
    await ctx.db.rpc("api_label_complete", {
      shipment_id: shipmentId,
      token: claim.token,
      ok: true,
      label_path: key,
      label_source: res.source,
      tracking_code: res.trackingCode,
      tracking_url: res.trackingUrl ?? (res.source === "carrier_api" ? trackingUrl(s.carrier, res.trackingCode, o.postal_code) : null),
      carrier_reference: res.carrierReference,
      actor,
    });
    return { ok: true, reuse: false, label_path: key };
  } catch (e) {
    await ctx.db.rpc("api_label_complete", { shipment_id: shipmentId, token: claim.token, ok: false, error: (e as Error).message });
    return { ok: false, error: "label_failed", message: (e as Error).message };
  }
}

export async function uploadLabel(
  ctx: Ctx,
  actor: string,
  shipmentId: string,
  file: { bytes: Uint8Array; type: string },
  tracking?: { code?: string; url?: string },
) {
  let pdf: Uint8Array;
  if (file.type === "application/pdf") pdf = file.bytes;
  else if (file.type === "image/png" || file.type === "image/jpeg") pdf = await imageToPdf(file.bytes, file.type);
  else return { ok: false, message: "Alleen PDF, PNG of JPG" };
  if (pdf.byteLength > 10 * 1024 * 1024) return { ok: false, message: "Bestand is groter dan 10 MB" };
  const shipment = await ctx.db.rpc<{ ship_date: string } | null>("api_shipment_get", { id: shipmentId });
  if (!shipment) return { ok: false, message: "Zending niet gevonden" };
  const key = `${shipment.ship_date}/${shipmentId}-upload-${randomBytes(4).toString("hex")}.pdf`;
  await ctx.storage.put("shipping-labels", key, pdf, "application/pdf");
  return ctx.db.rpc<{ ok: boolean; error?: string }>("api_label_attach_upload", {
    actor,
    shipment_id: shipmentId,
    label_path: key,
    tracking_code: tracking?.code,
    tracking_url: tracking?.url,
  });
}

export async function labelPdf(ctx: Ctx, shipmentId: string) {
  const s = await ctx.db.rpc<{ label_path: string | null; order_number: string } | null>("api_shipment_get", { id: shipmentId });
  if (!s?.label_path) return null;
  return { bytes: await ctx.storage.get("shipping-labels", s.label_path), filename: `label-${s.order_number}.pdf` };
}

export async function dayPdf(ctx: Ctx, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const labels = await ctx.db.rpc<{ label_path: string }[]>("api_day_labels", { date });
  if (labels.length === 0) return null;
  const files = await Promise.all(labels.map((l) => ctx.storage.get("shipping-labels", l.label_path)));
  return { bytes: await mergePdfs(files), filename: `labels-${date}.pdf`, count: labels.length };
}

async function afterStatus(ctx: Ctx, res: StatusResult) {
  if (res.ok && res.send_shipped_email && res.order_id) await sendOrderEmail(ctx, res.order_id, "shipped");
  if (res.ok && res.first_handover && res.channel === "bol") await processOutbox(ctx).catch(() => undefined);
  return res;
}

/** Handmatige bevestiging van fysieke overdracht (ook voor briefpost na het posten). */
export async function confirmHandover(ctx: Ctx, actor: string, shipmentId: string) {
  const res = await ctx.db.rpc<StatusResult>("api_shipment_handover", { actor, shipment_id: shipmentId });
  return afterStatus(ctx, res);
}

export async function applyCarrierEvent(
  ctx: Ctx,
  ev: { shipment_id?: string; tracking_code?: string; status: string; event_key: string; detail?: string; source?: string },
) {
  const res = await ctx.db.rpc<StatusResult>("api_shipment_carrier_event", ev);
  return afterStatus(ctx, res);
}

/** Alleen in testmodus: simuleer een vervoerdersscan. */
export async function simulateCarrierEvent(ctx: Ctx, actor: string, shipmentId: string, status: string) {
  if (ctx.carriers.mode !== "simulated") return { ok: false, message: "Alleen beschikbaar in testmodus" };
  return applyCarrierEvent(ctx, {
    shipment_id: shipmentId,
    status,
    event_key: `sim:${shipmentId}:${status}:${Date.now()}`,
    source: `simulatie:${actor}`,
  });
}
