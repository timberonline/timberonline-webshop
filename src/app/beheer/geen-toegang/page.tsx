import Link from "next/link";
import { AuthShell } from "../auth-shell";

export default function NoAccess() {
  return (
    <AuthShell title="Geen toegang">
      <p>Je account heeft geen toegang tot dit onderdeel van het beheer. Vraag de eigenaar om je rol aan te passen.</p>
      <Link href="/beheer/login">Inloggen met een ander account</Link>
    </AuthShell>
  );
}
