import type { Metadata } from "next";
import { notFound } from "next/navigation";

const PAGES: Record<string, { title: string; body: string[] }> = {
  verzending: {
    title: "Verzending",
    body: [
      "We verzenden binnen Nederland en België met DHL of PostNL. Je ontvangt een track & trace-code per e-mail zodra je zending aan de vervoerder is overgedragen.",
      "De verwachte levertermijn en de verzendkosten zie je in je winkelwagen vóór je betaalt.",
    ],
  },
  retourneren: {
    title: "Retourneren",
    body: [
      "Je hebt 14 dagen bedenktijd na ontvangst. Neem contact met ons op voor een retour; we beoordelen daarna of het artikel weer verkoopbaar is en betalen het aankoopbedrag terug volgens de wettelijke regels.",
    ],
  },
  voorwaarden: {
    title: "Algemene voorwaarden",
    body: ["De algemene voorwaarden worden vóór de opening van de webshop vastgesteld."],
  },
  privacy: {
    title: "Privacy",
    body: [
      "We gebruiken je gegevens alleen om je bestelling te verwerken, te verzenden en je daarover te informeren. Betalingen verlopen via Stripe; we slaan geen betaalgegevens op.",
      "De volledige privacyverklaring wordt vóór de opening van de webshop vastgesteld.",
    ],
  },
};

export async function generateMetadata({ params }: PageProps<"/info/[page]">): Promise<Metadata> {
  const { page } = await params;
  return { title: PAGES[page]?.title ?? "Informatie" };
}

export default async function InfoPage({ params }: PageProps<"/info/[page]">) {
  const { page } = await params;
  const p = PAGES[page];
  if (!p) notFound();
  return (
    <div className="container" style={{ margin: "32px auto", maxWidth: 760 }}>
      <div className="card">
        <p className="notice notice-warn">Concepttekst: wordt vóór de opening van de webshop gecontroleerd en vastgesteld.</p>
        <h1>{p.title}</h1>
        {p.body.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </div>
    </div>
  );
}
