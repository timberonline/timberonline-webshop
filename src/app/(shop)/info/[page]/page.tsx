import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OG_DEFAULTS } from "@/components/seo";
import { LEGAL_TEXTS_FINAL, WITHDRAWAL_LABELS, WITHDRAWAL_PATH } from "@/lib/legal";
import { getPublicBusiness } from "@/server/queries/business";
import { getCatalog } from "@/server/queries/catalog";
import { INFO_PAGES } from "../pages";
import { BODIES } from "./content";

export async function generateMetadata({ params }: PageProps<"/info/[page]">): Promise<Metadata> {
  const { page } = await params;
  const p = INFO_PAGES[page];
  if (!p) return { title: "Informatie" };
  const path = `/info/${page}`;
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: path },
    openGraph: { ...OG_DEFAULTS, title: `${p.title} · Timber Online`, description: p.description, url: path },
  };
}

export default async function InfoPage({ params }: PageProps<"/info/[page]">) {
  const { page } = await params;
  const p = INFO_PAGES[page];
  const body = BODIES[page];
  if (!p || !body) notFound();
  const [pb, catalog] = await Promise.all([getPublicBusiness(), getCatalog().catch(() => null)]);
  const others = Object.entries(INFO_PAGES).filter(([slug]) => slug !== page);
  return (
    <div className="container" style={{ margin: "0 auto 32px", maxWidth: 760 }}>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: p.title }]} />
      <div className="card legal-text">
        {LEGAL_TEXTS_FINAL ? null : (
          <p className="notice notice-warn">Concepttekst: wordt vóór de opening van de webshop gecontroleerd en vastgesteld. Gemarkeerde beleidskeuzes zijn nog niet besloten.</p>
        )}
        <h1>{p.title}</h1>
        {body({
          b: pb?.business ?? {},
          ret: pb?.return_address ?? {},
          shipping: catalog?.settings.shipping_options ?? [],
          deliveryPromise: catalog?.settings.delivery_promise ?? null,
        })}
      </div>
      <nav aria-labelledby="meer-klantenservice" className="card related-links">
        <h2 id="meer-klantenservice">Meer klantenservice</h2>
        <ul>
          <li>
            <Link href={WITHDRAWAL_PATH}>{WITHDRAWAL_LABELS.entry}</Link>
          </li>
          {others.map(([slug, o]) => (
            <li key={slug}>
              <Link href={`/info/${slug}`}>{o.title}</Link>
            </li>
          ))}
          <li>
            <Link href="/contact">Contact opnemen</Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
