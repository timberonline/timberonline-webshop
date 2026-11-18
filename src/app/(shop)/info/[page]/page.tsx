import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OG_DEFAULTS } from "@/components/seo";
import { INFO_PAGES } from "../pages";

/** Concepttekst; wordt vóór de opening van de webshop vastgesteld. */
const BODIES: Record<string, ReactNode[]> = {
  verzending: [
    "We verzenden binnen Nederland en België met DHL of PostNL. Je ontvangt een track & trace-code per e-mail zodra je zending aan de vervoerder is overgedragen.",
    "De verwachte levertermijn en de verzendkosten zie je in je winkelwagen vóór je betaalt.",
  ],
  retourneren: [
    <>
      Je hebt 14 dagen bedenktijd na ontvangst. <Link href="/contact">Neem contact met ons op</Link> voor een retour; we beoordelen daarna of het
      artikel weer verkoopbaar is en betalen het aankoopbedrag terug volgens de wettelijke regels.
    </>,
  ],
  voorwaarden: ["De algemene voorwaarden worden vóór de opening van de webshop vastgesteld."],
  privacy: [
    "We gebruiken je gegevens alleen om je bestelling te verwerken, te verzenden en je daarover te informeren. Betalingen verlopen via Stripe; we slaan geen betaalgegevens op.",
    "De volledige privacyverklaring wordt vóór de opening van de webshop vastgesteld.",
  ],
};

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
  const others = Object.entries(INFO_PAGES).filter(([slug]) => slug !== page);
  return (
    <div className="container" style={{ margin: "0 auto 32px", maxWidth: 760 }}>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: p.title }]} />
      <div className="card">
        <p className="notice notice-warn">Concepttekst: wordt vóór de opening van de webshop gecontroleerd en vastgesteld.</p>
        <h1>{p.title}</h1>
        {body.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </div>
      <nav aria-labelledby="meer-klantenservice" className="card related-links">
        <h2 id="meer-klantenservice">Meer klantenservice</h2>
        <ul>
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
