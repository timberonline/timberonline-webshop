import Link from "next/link";
import { AuthShell } from "../auth-shell";
import { isAllowedLinkType, safeAdminNext } from "../auth/link";
import { confirmLinkAction } from "./actions";

export default async function ConfirmLinkPage({ searchParams }: PageProps<"/beheer/link-bevestigen">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tokenHash = one(sp.token_hash);
  const type = one(sp.type);
  const next = safeAdminNext(one(sp.next));
  if (!tokenHash || !isAllowedLinkType(type)) {
    return (
      <AuthShell title="Link ongeldig">
        <p>Deze link is ongeldig of verlopen.</p>
        <p><Link href="/beheer/login">Naar inloggen</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={type === "invite" ? "Uitnodiging accepteren" : "Wachtwoord herstellen"}>
      <p>Ga alleen verder als je deze link zelf hebt aangevraagd of als uitnodiging hebt ontvangen. Daarna stel je een wachtwoord en tweestapsverificatie in.</p>
      <form action={confirmLinkAction}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn">Doorgaan</button>
      </form>
      <p className="small muted" style={{ marginTop: 12 }}><Link href="/beheer/login">Annuleren</Link></p>
    </AuthShell>
  );
}
