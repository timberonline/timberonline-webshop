import Link from "next/link";
import { connection } from "next/server";
import { AuthShell } from "../auth-shell";
import { createAuthClient } from "@/server/auth/supabase";
import { PasswordForm } from "./password-form";

export default async function PasswordPage() {
  await connection();
  const supabase = await createAuthClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const email = data.user?.email ?? null;
  if (!email) {
    return (
      <AuthShell title="Wachtwoord instellen">
        <p>Je sessie is verlopen. Vraag een nieuwe link aan via inloggen.</p>
        <p><Link href="/beheer/login">Naar inloggen</Link></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Wachtwoord instellen">
      {/* Laat zien voor welk account dit geldt: een onverwacht account wijst op een verkeerde of misbruikte link. */}
      <p>Je stelt een wachtwoord in voor <strong>{email}</strong>. Is dit niet jouw account? <Link href="/beheer/uitloggen">Uitloggen</Link>.</p>
      <PasswordForm />
    </AuthShell>
  );
}
