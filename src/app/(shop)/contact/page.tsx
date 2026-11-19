import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OG_DEFAULTS } from "@/components/seo";
import { getPublicBusiness } from "@/server/queries/business";
import { addressLine, COUNTRY_NAME, telHref } from "@/server/services/business";
import { CONTACT_SUBJECTS, contactRecipient, publicContactEmail } from "@/server/services/contact";
import { WITHDRAWAL_LABELS, WITHDRAWAL_PATH } from "@/lib/legal";
import { INFO_PAGES } from "../info/pages";
import { ContactForm } from "./contact-form";

const DESCRIPTION = "Vraag over je bestelling, een product of retourneren? Neem contact op met Timber Online via het contactformulier, e-mail of telefoon.";

export const metadata: Metadata = {
  title: "Contact",
  description: DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: { ...OG_DEFAULTS, title: "Contact · Timber Online", description: DESCRIPTION, url: "/contact" },
};

export default async function ContactPage() {
  // Configuratie (ontvanger, publiek e-mailadres) per request lezen, niet vastleggen tijdens de build.
  await connection();
  const pb = await getPublicBusiness();
  const b = pb?.business;
  const ret = pb?.return_address;
  const email = publicContactEmail(process.env, b?.email);
  const active = contactRecipient(process.env, b?.email) !== null;
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
            {email || b?.phone ? (
              <dl className="dl">
                {email ? (
                  <>
                    <dt>E-mail</dt>
                    <dd>
                      <a href={`mailto:${email}`}>{email}</a>
                    </dd>
                  </>
                ) : null}
                {b?.phone ? (
                  <>
                    <dt>Telefoon</dt>
                    <dd>
                      <a href={telHref(b.phone)}>{b.phone}</a>
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p style={{ margin: 0 }}>Contactgegevens volgen.</p>
            )}
            <p className="small muted" style={{ margin: "8px 0 0" }}>We beantwoorden je bericht zo snel mogelijk. Vermeld bij een vraag over een bestelling je bestelnummer.</p>
          </section>
          {b ? (
            <section aria-labelledby="contact-bedrijf" className="card">
              <h2 id="contact-bedrijf">Bedrijfsgegevens</h2>
              <dl className="dl">
                <dt>Webshop</dt>
                <dd>{b.shop_name}</dd>
                <dt>Onderneming</dt>
                <dd>{b.legal_name}</dd>
                {addressLine(b) ? (
                  <>
                    <dt>Adres</dt>
                    <dd>{addressLine(b)}{b.country ? `, ${COUNTRY_NAME[b.country] ?? b.country}` : ""}</dd>
                  </>
                ) : null}
                {b.kvk ? (
                  <>
                    <dt>KvK-nummer</dt>
                    <dd>{b.kvk}</dd>
                  </>
                ) : null}
                {b.vat_id ? (
                  <>
                    <dt>Btw-id</dt>
                    <dd>{b.vat_id}</dd>
                  </>
                ) : null}
                {ret && addressLine(ret) ? (
                  <>
                    <dt>Retouradres</dt>
                    <dd>{ret.name}, {addressLine(ret)}</dd>
                  </>
                ) : null}
              </dl>
              <p className="small muted" style={{ margin: "8px 0 0" }}>
                Retourneren? Lees eerst <Link href="/info/retourneren">hoe herroepen en retourneren werkt</Link>.
              </p>
            </section>
          ) : null}
          <nav aria-labelledby="contact-klantenservice" className="card related-links">
            <h2 id="contact-klantenservice">Klantenservice</h2>
            <ul>
              <li>
                <Link href={WITHDRAWAL_PATH}>{WITHDRAWAL_LABELS.entry}</Link>
              </li>
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
