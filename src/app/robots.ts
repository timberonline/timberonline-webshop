import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { absoluteUrl, siteUrl } from "@/components/seo";

/** robots.txt: beheer, API en de persoonlijke winkelwagen-/bestelpagina's niet laten crawlen. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  // Basis-URL per request uit de omgeving lezen (APP_URL), niet vastleggen tijdens de build.
  await connection();
  const base = siteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/beheer", "/api", "/winkelwagen", "/bestelling"] },
    sitemap: absoluteUrl("/sitemap.xml", base),
  };
}
