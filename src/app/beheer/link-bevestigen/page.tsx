import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { AuthShell } from "../auth-shell";
import { decodePendingLink, LINK_COOKIE } from "../auth/link";
import { confirmLinkAction } from "./actions";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ConfirmLinkPage() {
  const pending = decodePendingLink((await cookies()).get(LINK_COOKIE)?.value);
  if (!pending) {
    return (
      <AuthShell title="Link ongeldig">
        <p>Deze link is ongeldig, al gebruikt of verlopen. Vraag een nieuwe aan via inloggen.</p>
        <p><Link href="/beheer/login">Naar inloggen</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={pending.type === "invite" ? "Uitnodiging accepteren" : "Wachtwoord herstellen"}>
      <p>Ga alleen verder als je deze link zelf hebt aangevraagd of als uitnodiging hebt ontvangen. Daarna stel je een wachtwoord en tweestapsverificatie in.</p>
      <form action={confirmLinkAction}>
        <button type="submit" className="btn">Doorgaan</button>
      </form>
      <p className="small muted" style={{ marginTop: 12 }}><Link href="/beheer/login">Annuleren</Link></p>
    </AuthShell>
  );
}
