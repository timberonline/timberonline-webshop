"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin, ROLES } from "@/server/auth/admin";
import { parseEuroToCents } from "@/lib/format";
import { getCtx } from "@/server/services/runtime";
import { processBolQueue } from "@/server/services/bol-sync";
import { back, errText, str } from "../_lib";

export async function setPriceAction(fd: FormData) {
  const id = str(fd, "product_id");
  const to = str(fd, "return_to") || `/beheer/artikelen/${id}`;
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    const channel = str(fd, "channel");
    const cents = parseEuroToCents(str(fd, "price"));
    if (cents === null) throw new Error("Ongeldige prijs");
    const res = await getCtx().db.rpc<{ ok: boolean; error?: string; old_cents: number; new_cents: number }>("api_set_price", {
      actor: s.actor,
      product_id: id,
      channel,
      price_cents: cents,
      source: "manual",
    });
    if (channel === "bol") await processBolQueue(getCtx()).catch(() => undefined);
    msg = res.ok ? { ok: `Prijs ${channel === "web" ? "webshop" : "bol"} aangepast` } : { fout: res.error };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/artikelen");
  back(to, msg);
}

const CARRIERS = ["dhl", "postnl", "letter"];

export async function saveProductAction(fd: FormData) {
  const id = str(fd, "id");
  let msg: { ok?: string; fout?: string };
  let target = id ? `/beheer/artikelen/${id}` : "/beheer/artikelen/nieuwe-bundel";
  try {
    const s = await requireAdmin(ROLES.catalog);
    const ctx = getCtx();
    const allowed = CARRIERS.filter((c) => fd.get(`carrier_${c}`) === "on");
    const devices = [...fd.entries()]
      .filter(([k, v]) => k.startsWith("dev_") && v !== "none")
      .map(([k, v]) => ({ slug: k.slice(4), confirmed: v === "confirmed" }));
    const comps = [...fd.entries()]
      .filter(([k, v]) => k.startsWith("comp_") && Number(v) > 0)
      .map(([k, v]) => ({ component_id: k.slice(5), qty: Number(v) }));
    const payload: Record<string, unknown> = {
      actor: s.actor,
      title: str(fd, "title"),
      subtitle: str(fd, "subtitle"),
      description: str(fd, "description"),
      status: str(fd, "status"),
      review_note: str(fd, "review_note"),
      allowed_carriers: allowed,
      preferred_carrier: str(fd, "preferred_carrier"),
      packed_weight_g: Number(str(fd, "packed_weight_g")) || undefined,
      package_format: str(fd, "package_format"),
      allow_tier_discount: fd.get("allow_tier_discount") === "on",
      web_enabled: fd.get("web_enabled") === "on",
      devices,
    };
    if (!id) {
      const cents = parseEuroToCents(str(fd, "web_price"));
      if (cents === null) throw new Error("Ongeldige bundelprijs");
      Object.assign(payload, { kind: "bundle", sku: str(fd, "sku"), slug: str(fd, "slug"), web_price_cents: cents, components: comps });
    } else {
      Object.assign(payload, {
        id,
        ean: str(fd, "ean"),
        bol_reference: str(fd, "bol_reference"),
        bol_offer_id: str(fd, "bol_offer_id"),
        bol_title: str(fd, "bol_title"),
        bol_title_fix_required: fd.get("bol_title_fix_required") === "on",
        bol_enabled: fd.get("bol_enabled") === "on",
        bol_buffer_units: str(fd, "bol_buffer_units"),
      });
      if (fd.get("is_bundle") === "1") payload.components = comps;
    }
    const file = fd.get("image");
    if (file instanceof File && file.size > 0) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Foto moet PNG, JPG of WebP zijn");
      if (file.size > 5 * 1024 * 1024) throw new Error("Foto is groter dan 5 MB");
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const key = `products/${(id || str(fd, "sku")).toLowerCase().replace(/[^a-z0-9-]/g, "")}-${randomBytes(4).toString("hex")}.${ext}`;
      await ctx.storage.put("product-images", key, new Uint8Array(await file.arrayBuffer()), file.type);
      payload.image_path = key;
    }
    const res = await ctx.db.rpc<{ ok: boolean; id: string; error?: string }>("api_product_save", payload);
    if (!res.ok) throw new Error(res.error);
    await processBolQueue(ctx).catch(() => undefined);
    target = `/beheer/artikelen/${res.id}`;
    msg = { ok: id ? "Artikel opgeslagen" : "Bundel aangemaakt" };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/artikelen");
  back(target, msg);
}

/** Nieuwe set of nieuw hoesje (altijd als concept; voorraad start op 0 en komt via Voorraad). */
export async function createProductAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  let target = "/beheer/artikelen/nieuw-artikel";
  try {
    const s = await requireAdmin(ROLES.catalog);
    const kind = str(fd, "kind");
    if (kind !== "set" && kind !== "case") throw new Error("Kies set of hoesje");
    const web = parseEuroToCents(str(fd, "web_price"));
    if (web === null) throw new Error("Ongeldige webshopprijs");
    const bolRaw = str(fd, "bol_price");
    const bol = bolRaw ? parseEuroToCents(bolRaw) : null;
    if (bolRaw && bol === null) throw new Error("Ongeldige bol-prijs");
    const componentId = str(fd, "component_id");
    const devices = [...fd.entries()]
      .filter(([k, v]) => k.startsWith("dev_") && v !== "none")
      .map(([k, v]) => ({ slug: k.slice(4), confirmed: v === "confirmed" }));
    const res = await getCtx().db.rpc<{ ok: boolean; id: string; error?: string }>("api_product_save", {
      actor: s.actor,
      kind,
      product_type: kind === "case" ? "hoesje" : str(fd, "product_type"),
      sku: str(fd, "sku"),
      slug: str(fd, "slug"),
      title: str(fd, "title"),
      subtitle: str(fd, "subtitle"),
      description: str(fd, "description"),
      web_price_cents: web,
      bol_price_cents: bol ?? "",
      ean: str(fd, "ean"),
      bol_reference: str(fd, "bol_reference"),
      bol_offer_id: str(fd, "bol_offer_id"),
      bol_title: str(fd, "bol_title"),
      pack_qty: Number(str(fd, "pack_qty")) || undefined,
      review_note: str(fd, "review_note"),
      status: "concept",
      ...(componentId ? { component_id: componentId } : { new_component: { code: str(fd, "new_component_code"), name: str(fd, "new_component_name") } }),
      devices,
    });
    if (!res.ok) throw new Error(res.error);
    target = `/beheer/artikelen/${res.id}`;
    msg = { ok: "Artikel aangemaakt als concept. Controleer de gegevens en zet het daarna op actief." };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/artikelen");
  back(target, msg);
}

/** Nieuw of gewijzigd toestelmodel voor compatibiliteit en filters. */
export async function saveDeviceAction(fd: FormData) {
  let msg: { ok?: string; fout?: string };
  try {
    const s = await requireAdmin(ROLES.catalog);
    const res = await getCtx().db.rpc<{ ok: boolean; slug: string }>("api_device_save", {
      actor: s.actor,
      slug: str(fd, "slug"),
      name: str(fd, "name"),
      family: str(fd, "family"),
      sort: Number(str(fd, "sort")) || undefined,
    });
    msg = { ok: `Toestel ${res.slug} opgeslagen` };
  } catch (e) {
    msg = { fout: errText(e) };
  }
  revalidatePath("/beheer/artikelen");
  back("/beheer/artikelen/nieuw-artikel", msg);
}
