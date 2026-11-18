"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { getCtx } from "@/server/services/runtime";
import { importBolOrder, processBolQueue, processOutbox, reconcileBol } from "@/server/services/bol-sync";
import { back, errText, str } from "../_lib";

export async function syncNowAction() {
  let msg: { ok?: string; fout?: string };
  try {
    await requireAdmin(ROLES.catalog);
    const ctx = getCtx();
    const r = await processBolQueue(ctx, { limit: 100 });
    const o = await processOutbox(ctx);
    const failed = r.filter((x) => x.result === "error").length + o.filter((x) => !x.ok).length;
    msg = failed ? { fout: `${r.length} updates, ${o.length} verzendbevestigingen verwerkt; ${failed} mislukt` } : { ok: `${r.length} updates en ${o.length} verzendbevestigingen verwerkt` };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/bol");
  back("/beheer/bol", msg);
}

export async function enqueueAllAction() {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    await getCtx().db.rpc("api_bol_sync_enqueue_all", { actor: s.actor });
    await processBolQueue(getCtx(), { limit: 100 });
    msg = { ok: "Alle bol-standen opnieuw berekend en verstuurd" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/bol");
  back("/beheer/bol", msg);
}

export async function retryAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    const ctx = getCtx();
    if (str(fd, "outbox_id")) await ctx.db.rpc("api_outbox_retry", { actor: s.actor, id: str(fd, "outbox_id") });
    else await ctx.db.rpc("api_bol_sync_retry", { actor: s.actor, product_id: str(fd, "product_id"), kind: str(fd, "kind") || undefined });
    await processBolQueue(ctx);
    await processOutbox(ctx);
    msg = { ok: "Opnieuw geprobeerd" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/bol");
  back("/beheer/bol", msg);
}

export async function reconcileAction() {
  let msg: { ok?: string; fout?: string };
  try {
    await requireAdmin(ROLES.catalog);
    const r = await reconcileBol(getCtx());
    msg = { ok: `Vergelijking klaar: ${r.differences} verschil(len) opnieuw in de wachtrij` };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/bol");
  back("/beheer/bol", msg);
}

/** Alleen testmodus: simuleer een binnenkomende bol-order met testgegevens. */
export async function simulateOrderAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    const ctx = getCtx();
    if (ctx.bol.mode !== "simulated") throw new Error("Alleen beschikbaar in testmodus");
    const products = await ctx.db.rpc<{ id: string; sku: string; bol_offer_id: string | null; bol_reference: string | null; ean: string | null; bol_price_cents: number | null }[]>("api_admin_products", { id: str(fd, "product_id") });
    const p = products[0];
    if (!p) throw new Error("Artikel niet gevonden");
    const id = `SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
    const res = await importBolOrder(
      ctx,
      {
        bol_order_id: id,
        ship_deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
        customer: { name: "Test Klant (bol-simulatie)", street: "Teststraat", house_number: "1", postal_code: "1234 AB", city: "Teststad", country: "NL" },
        items: [{ order_item_id: `${id}-1`, offer_id: p.bol_offer_id, reference: p.bol_reference, ean: p.ean, qty: Math.max(1, Number(str(fd, "qty")) || 1), unit_price_cents: p.bol_price_cents ?? 1995 }],
      },
      `simulatie:${s.actor}`,
    );
    msg = { ok: `Gesimuleerde bol-order ${id} verwerkt (${res.stock_status})` };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/bol");
  back("/beheer/bol", msg);
}
