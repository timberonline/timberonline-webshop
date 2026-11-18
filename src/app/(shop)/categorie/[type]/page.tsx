import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CatalogListing } from "@/components/catalog-listing";
import { categoryBySlug, categoryByType, categoryPath } from "@/components/categories";
import { OG_DEFAULTS } from "@/components/seo";
import { getCatalog } from "@/server/queries/catalog";

// Voorraad en prijzen komen live uit de database; de pagina wordt per request opgebouwd.
// Onbekende categorieën geven een 404; de ruwe producttypewaarde (bijv. /categorie/privacy) verwijst door.
function resolve(slug: string) {
  const category = categoryBySlug(slug);
  if (category) return category;
  const byType = categoryByType(slug);
  if (byType) permanentRedirect(categoryPath(byType));
  notFound();
}

export async function generateMetadata({ params }: PageProps<"/categorie/[type]">): Promise<Metadata> {
  const { type } = await params;
  const c = resolve(type);
  const title = `${c.name} voor iPhone`;
  const path = categoryPath(c);
  return {
    title,
    description: c.intro,
    alternates: { canonical: path },
    openGraph: { ...OG_DEFAULTS, title: `${title} · Timber Online`, description: c.intro, url: path },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/categorie/[type]">) {
  const { type } = await params;
  const category = resolve(type);
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const filter = { q: one(sp.q), toestel: one(sp.toestel) };
  const catalog = await getCatalog();

  return (
    <>
      <section className="hero">
        <div className="container">
          <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: category.name }]} />
          <h1>{category.name} voor iPhone</h1>
          <p>{category.intro}</p>
        </div>
      </section>
      <CatalogListing catalog={catalog} filter={filter} category={category} />
    </>
  );
}
