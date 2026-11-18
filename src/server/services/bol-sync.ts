import type { Ctx } from "./context";
import type { BolOrder } from "../integrations/bol";

type ClaimItem = {
  product_id: string;
  kind: "stock" | "price";
  action: "push" | "check";
  token: string;
  value: number;
  process_id: string | null;
  offer_id: string | null;
  reference: string | null;
  ean: string | null;
};

/** Verwerkt openstaande bol-updates. Altijd de nieuwste stand; nooit twee updates tegelijk per aanbod. */
export async function processBolQueue(ctx: Ctx, opts: { limit?: number } = {}) {
  const { items } = await ctx.db.rpc<{ items: ClaimItem[] }>("api_bol_sync_claim", { limit: opts.limit ?? 25 });
  const results: { product_id: string; kind: string; result: string; error?: string }[] = [];
  for (const it of items) {
    const ref = { offerId: it.offer_id, reference: it.reference, ean: it.ean };
    let payload: Record<string, unknown>;
    try {
      if (it.action === "check") {
        const r = await ctx.bol.checkProcess(it.process_id!);
        payload =
          r.status === "done"
            ? { result: "done" }
            : r.status === "pending"
              ? { result: "submitted", process_id: it.process_id }
              : { result: "error", error: r.error };
      } else {
        const r = it.kind === "stock" ? await ctx.bol.updateStock(ref, it.value) : await ctx.bol.updatePrice(ref, it.value);
        payload = r.status === "done" ? { result: "done" } : { result: "submitted", process_id: r.processId };
      }
    } catch (e) {
      payload = { result: "error", error: (e as Error).message };
    }
    await ctx.db.rpc("api_bol_sync_complete", { product_id: it.product_id, kind: it.kind, token: it.token, ...payload });
    results.push({ product_id: it.product_id, kind: it.kind, result: String(payload.result), error: payload.error as string | undefined });
  }
  return results;
}

/** Geeft verzendbevestigingen van bol-orders door (één keer per order, met herpogingen en processtatuscontrole). */
export async function processOutbox(ctx: Ctx) {
  const { items } = await ctx.db.rpc<{ items: { id: string; kind: string; token: string; action: "push" | "check"; process_id: string | null; payload: { order_id: string } }[] }>(
    "api_outbox_claim",
    { kind: "bol_shipment" },
  );
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const it of items) {
    let payload: Record<string, unknown>;
    try {
      if (it.action === "check" && it.process_id) {
        const r = await ctx.bol.checkProcess(it.process_id);
        payload = r.status === "done" ? { result: "done" } : r.status === "pending" ? { result: "submitted" } : { result: "error", error: r.error };
      } else {
        const p = await ctx.db.rpc<{ order_item_ids: string[]; carrier: string; tracking_code: string | null } | null>("api_bol_shipment_payload", {
          order_id: it.payload.order_id,
        });
        if (!p) throw new Error("Zending niet gevonden");
        if (p.carrier !== "letter" && !p.tracking_code) throw new Error("Trackingcode ontbreekt");
        const r = await ctx.bol.confirmShipment({ orderItemIds: p.order_item_ids, carrier: p.carrier, trackingCode: p.tracking_code });
        payload = r.status === "done" ? { result: "done" } : { result: "submitted", process_id: r.processId };
      }
    } catch (e) {
      payload = { result: "error", error: (e as Error).message };
    }
    await ctx.db.rpc("api_outbox_complete", { id: it.id, token: it.token, ...payload });
    results.push({ id: it.id, ok: payload.result !== "error", error: payload.error as string | undefined });
  }
  return results;
}

export async function importBolOrder(ctx: Ctx, order: BolOrder, actor = "system:bol") {
  const res = await ctx.db.rpc<{ ok: boolean; order_id: string; new_lines: number; stock_status: string }>("api_bol_import_order", {
    ...order,
    actor,
  });
  await processBolQueue(ctx).catch(() => undefined);
  return res;
}

export async function pollBolOrders(ctx: Ctx) {
  const orders = await ctx.bol.fetchOpenOrders();
  const out = [];
  for (const o of orders) out.push(await importBolOrder(ctx, o));
  return out;
}

/**
 * Vergelijkt de stand bij bol (live of gesimuleerd) met de gewenste stand en zet verschillen opnieuw in de wachtrij.
 * Vangt ook het zeldzame geval af dat een eerder verzonden update bij bol later is verwerkt dan een nieuwere.
 */
export async function reconcileBol(ctx: Ctx) {
  const bol = await ctx.db.rpc<{ sync: { product_id: string; bol_offer_id: string | null; bol_reference: string | null; ean: string | null; bol_enabled: boolean }[] }>(
    "api_admin_bol",
    {},
  );
  const items = [];
  for (const p of bol.sync.filter((x) => x.bol_enabled)) {
    const o = await ctx.bol.readOffer({ offerId: p.bol_offer_id, reference: p.bol_reference, ean: p.ean });
    items.push({ product_id: p.product_id, kind: "stock", remote_value: o?.stock ?? null });
    items.push({ product_id: p.product_id, kind: "price", remote_value: o?.priceCents ?? null });
  }
  return ctx.db.rpc<{ differences: number }>("api_bol_record_remote", { items });
}
