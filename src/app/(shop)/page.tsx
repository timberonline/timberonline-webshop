import type { Metadata } from "next";
import { CatalogListing } from "@/components/catalog-listing";
import { OG_DEFAULTS } from "@/components/seo";
import { getCatalog } from "@/server/queries/catalog";

const DESCRIPTION = "Screenprotectors van 9H gehard glas, privacyfilters en MagSafe-hoesjes voor je iPhone. Kies je toestel en zie direct wat past.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  // Zoek- en filterresultaten (?q=, ?toestel=, ?type=) verwijzen naar de startpagina als canonieke versie.
  alternates: { canonical: "/" },
  openGraph: { ...OG_DEFAULTS, title: "Timber Online", description: DESCRIPTION, url: "/" },
};

export default async function CatalogPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const filter = { q: one(sp.q), toestel: one(sp.toestel), type: one(sp.type) };
  const catalog = await getCatalog();

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Bescherming voor je iPhone</h1>
          <p>Screenprotectors van 9H gehard glas, privacyfilters en MagSafe-hoesjes. Kies je toestel en zie direct wat past.</p>
        </div>
      </section>
      <CatalogListing catalog={catalog} filter={filter} />
    </>
  );
}
