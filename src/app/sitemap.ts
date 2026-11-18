import type { MetadataRoute } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { CATEGORIES, categoryPath } from "@/components/categories";
import { absoluteUrl, siteUrl } from "@/components/seo";
import { loadCatalog } from "@/server/queries/catalog";
import { INFO_SLUGS } from "./(shop)/info/pages";

/** Sitemap van de winkel: start, categorieën, producten (live uit de catalogus), contact en klantenservice. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Producten en basis-URL per request; de sitemap volgt zo de actuele catalogus.
  await connection();
  const base = siteUrl();
  const url = (path: string) => absoluteUrl(path, base);
  const entries: MetadataRoute.Sitemap = [
    { url: url("/"), changeFrequency: "daily", priority: 1 },
    ...CATEGORIES.map((c) => ({ url: url(categoryPath(c)), changeFrequency: "daily" as const, priority: 0.8 })),
  ];
  try {
    const catalog = await loadCatalog();
    for (const p of catalog.products) entries.push({ url: url(`/product/${p.slug}`), changeFrequency: "weekly", priority: 0.7 });
  } catch (e) {
    unstable_rethrow(e);
    // Zonder database toch een bruikbare sitemap leveren met de vaste pagina's.
    console.error("Sitemap: catalogus niet geladen:", e instanceof Error ? e.message : e);
  }
  entries.push({ url: url("/contact"), changeFrequency: "monthly", priority: 0.4 });
  for (const slug of INFO_SLUGS) entries.push({ url: url(`/info/${slug}`), changeFrequency: "monthly", priority: 0.3 });
  return entries;
}
