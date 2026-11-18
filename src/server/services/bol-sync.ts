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

/**
 * Verwerkt openstaande bol-updates. Claimt één item per keer zodat de claimtermijn pas start vlak vóór het verzoek;
 * altijd de nieuwste stand, nooit twee updates tegelijk per aanbod, en een ingediend verzoek wordt eerst gecontroleerd
 * (processtatus) voordat er opnieuw iets wordt ingediend.
 */
export async function processBolQueue(ctx: Ctx, opts: { limit?: number } = {}) {
  const results: { product_id: string; kind: string; result: string; error?: string }[] = [];
  for (let i = 0; i < (opts.limit ?? 25); i++) {
    const { items } = await ctx.db.rpc<{ items: ClaimItem[] }>("api_bol_sync_claim", { limit: 1 });
    const it = items[0];
    if (!it) break;
    const ref = { offerId: it.offer_id, reference: it.reference, ean: it.ean };
    let payload: Record<string, unknown>;
    if (it.action === "check") {
      try {
        const r = await ctx.bol.checkProcess(it.process_id!);
        payload =
          r.status === "done"
            ? { result: "done" }
            : r.status === "pending"
              ? { result: "submitted", process_id: it.process_id }
              : { result: "error", error: r.error }; // definitief afgewezen → opnieuw indienen met nieuwste stand
      } catch (e) {
        payload = { result: "check_error", error: (e as Error).message }; // tijdelijk: proces-ID bewaren
      }
    } else {
      try {
        const r = it.kind === "stock" ? await ctx.bol.updateStock(ref, it.value) : await ctx.bol.updatePrice(ref, it.value);
        payload = r.status === "done" ? { result: "done" } : { result: "submitted", process_id: r.processId };
      } catch (e) {
        payload = { result: "error", error: (e as Error).message };
      }
    }
    await ctx.db.rpc("api_bol_sync_complete", { product_id: it.product_id, kind: it.kind, token: it.token, ...payload });
    results.push({ product_id: it.product_id, kind: it.kind, result: String(payload.result), error: payload.error as string | undefined });
  }
  return results;
}

/** Geeft verzendbevestigingen van bol-orders door (één keer per order, met herpogingen en processtatuscontrole). */
export async function processOutbox(ctx: Ctx, opts: { limit?: number } = {}) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (let i = 0; i < (opts.limit ?? 20); i++) {
    const { items } = await ctx.db.rpc<{ items: { id: string; kind: string; token: string; action: "push" | "check"; process_id: string | null; payload: { order_id: string } }[] }>(
      "api_outbox_claim",
      { kind: "bol_shipment", limit: 1 },
    );
    const it = items[0];
    if (!it) break;
    let payload: Record<string, unknown>;
    if (it.action === "check" && it.process_id) {
      try {
        const r = await ctx.bol.checkProcess(it.process_id);
        payload = r.status === "done" ? { result: "done" } : r.status === "pending" ? { result: "submitted" } : { result: "error", error: r.error };
      } catch (e) {
        payload = { result: "check_error", error: (e as Error).message };
      }
    } else {
      try {
        const p = await ctx.db.rpc<{ order_item_ids: string[]; carrier: string; tracking_code: string | null } | null>("api_bol_shipment_payload", {
          order_id: it.payload.order_id,
        });
        if (!p) throw new Error("Zending niet gevonden");
        if (p.carrier !== "letter" && !p.tracking_code) throw new Error("Trackingcode ontbreekt");
        const r = await ctx.bol.confirmShipment({ orderItemIds: p.order_item_ids, carrier: p.carrier, trackingCode: p.tracking_code });
        payload = r.status === "done" ? { result: "done" } : { result: "submitted", process_id: r.processId };
      } catch (e) {
        payload = { result: "error", error: (e as Error).message };
      }
    }
    await ctx.db.rpc("api_outbox_complete", { id: it.id, token: it.token, ...payload });
    results.push({ id: it.id, ok: payload.result === "done" || payload.result === "submitted", error: payload.error as string | undefined });
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
  const bol = await ctx.db.rpc<{ sync: { product_id: string; sku: string; bol_offer_id: string | null; bol_reference: string | null; ean: string | null; bol_enabled: boolean }[] }>(
    "api_admin_bol",
    {},
  );
  const items = [];
  const errors: { sku: string; error: string }[] = [];
  for (const p of bol.sync.filter((x) => x.bol_enabled)) {
    try {
      const o = await ctx.bol.readOffer({ offerId: p.bol_offer_id, reference: p.bol_reference, ean: p.ean });
      items.push({ product_id: p.product_id, kind: "stock", remote_value: o?.stock ?? null });
      items.push({ product_id: p.product_id, kind: "price", remote_value: o?.priceCents ?? null });
    } catch (e) {
      // één defect aanbod mag de controle van de andere niet blokkeren
      errors.push({ sku: p.sku, error: (e as Error).message });
    }
  }
  const res = items.length ? await ctx.db.rpc<{ differences: number }>("api_bol_record_remote", { items }) : { differences: 0 };
  return { differences: res.differences, errors };
}
