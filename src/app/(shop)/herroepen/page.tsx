import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { OG_DEFAULTS } from "@/components/seo";
import { WITHDRAWAL_DAYS, WITHDRAWAL_LABELS } from "@/lib/legal";
import { getPublicBusiness } from "@/server/queries/business";
import { WithdrawalForm } from "./withdrawal-form";

const DESCRIPTION = `Bestelling herroepen binnen de bedenktijd van ${WITHDRAWAL_DAYS} dagen: vul het formulier in en bevestig. Je krijgt direct een ontvangstbevestiging per e-mail.`;

export const metadata: Metadata = {
  title: "Overeenkomst herroepen",
  description: DESCRIPTION,
  alternates: { canonical: "/herroepen" },
  openGraph: { ...OG_DEFAULTS, title: "Overeenkomst herroepen · Timber Online", description: DESCRIPTION, url: "/herroepen" },
};

export default async function WithdrawalPage() {
  const pb = await getPublicBusiness();
  const email = pb?.business?.email ?? null;
  return (
    <div className="container" style={{ margin: "0 auto 32px", maxWidth: 760 }}>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Overeenkomst herroepen" }]} />
      <div className="card">
        <h1>{WITHDRAWAL_LABELS.entry}</h1>
        <p className="lead">
          Je hebt {WITHDRAWAL_DAYS} dagen bedenktijd nadat je je bestelling hebt ontvangen. Wil je je bestelling (of een deel ervan) herroepen? Vul dit
          formulier in en bevestig. Je ontvangt direct een ontvangstbevestiging per e-mail met de datum en tijd van je herroeping.
        </p>
        <p className="small muted">
          Je kunt ook herroepen met het <Link href="/info/herroepingsformulier">modelformulier</Link> of met een andere duidelijke verklaring
          {email ? (
            <>
              {" "}
              per e-mail aan <a href={`mailto:${email}`}>{email}</a>
            </>
          ) : null}
          . Lees ook <Link href="/info/retourneren">hoe herroepen en retourneren werkt</Link>.
        </p>
        <WithdrawalForm />
      </div>
    </div>
  );
}
