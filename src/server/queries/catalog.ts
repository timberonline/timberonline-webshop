import "server-only";
import { connection } from "next/server";
import { getDb } from "../db";
import { productImageUrl } from "../storage";
import type { Catalog, CatalogProduct } from "../services/types";

export async function loadCatalog(): Promise<Catalog> {
  await connection();
  const cat = await getDb().rpc<Catalog>("api_catalog", {});
  return { ...cat, products: cat.products.map((p) => ({ ...p, image_path: productImageUrl(p.image_path) })) };
}

export type CatalogFilter = { q?: string; toestel?: string; type?: string };

function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function filterProducts(products: CatalogProduct[], f: CatalogFilter) {
  const terms = f.q ? normalize(f.q).split(" ").filter(Boolean) : [];
  return products.filter((p) => {
    if (f.toestel && !p.devices.some((d) => d.slug === f.toestel)) return false;
    if (f.type && p.product_type !== f.type) return false;
    if (terms.length) {
      const hay = normalize([p.title, p.subtitle, p.sku, p.ean, p.product_type, ...p.devices.map((d) => d.name)].filter(Boolean).join(" "));
      return terms.every((t) => hay.includes(t));
    }
    return true;
  });
}
