import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OG_DEFAULTS } from "@/components/seo";
import { CONTACT_SUBJECTS, contactRecipient, publicContactEmail } from "@/server/services/contact";
import { INFO_PAGES } from "../info/pages";
import { ContactForm } from "./contact-form";

const DESCRIPTION = "Vraag over je bestelling, een product of retourneren? Neem contact op met Timber Online via het contactformulier.";

export const metadata: Metadata = {
  title: "Contact",
  description: DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: { ...OG_DEFAULTS, title: "Contact · Timber Online", description: DESCRIPTION, url: "/contact" },
};

export default async function ContactPage() {
  // Configuratie (ontvanger, publiek e-mailadres) per request lezen, niet vastleggen tijdens de build.
  await connection();
  const email = publicContactEmail();
  const active = contactRecipient() !== null;
  const subjects = Object.entries(CONTACT_SUBJECTS).map(([value, label]) => ({ value, label }));

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Contact" }]} />
      <h1>Contact</h1>
      <p className="lead">Heb je een vraag over je bestelling, een product of retourneren? Stuur ons een bericht via het formulier.</p>
      <div className="layout-2" style={{ marginTop: 16 }}>
        <section aria-labelledby="contact-formulier" className="card">
          <h2 id="contact-formulier">Stuur een bericht</h2>
          {active ? null : (
            <p className="notice notice-warn">
              Het contactformulier is nog niet actief: berichten worden nog niet verstuurd.{" "}
              {email ? (
                <>
                  Mail je vraag naar <a href={`mailto:${email}`}>{email}</a>.
                </>
              ) : null}
            </p>
          )}
          <ContactForm subjects={subjects} contactEmail={email} />
        </section>

        <div className="stack">
          <section aria-labelledby="contact-gegevens" className="card">
            <h2 id="contact-gegevens">Contactgegevens</h2>
            {email ? (
              <dl className="dl">
                <dt>E-mail</dt>
                <dd>
                  <a href={`mailto:${email}`}>{email}</a>
                </dd>
              </dl>
            ) : (
              <>
                <p className="notice notice-warn">Concepttekst: contactgegevens worden vóór de opening van de webshop vastgesteld.</p>
                <p style={{ margin: 0 }}>Contactgegevens volgen.</p>
              </>
            )}
          </section>
          <nav aria-labelledby="contact-klantenservice" className="card related-links">
            <h2 id="contact-klantenservice">Klantenservice</h2>
            <ul>
              {Object.entries(INFO_PAGES).map(([slug, p]) => (
                <li key={slug}>
                  <Link href={`/info/${slug}`}>{p.title}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
