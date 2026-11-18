import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (
    <AuthShell title="Inloggen beheer">
      {configured ? <LoginForm /> : <p className="notice notice-warn">Inloggen is nog niet geconfigureerd (Supabase Auth ontbreekt).</p>}
    </AuthShell>
  );
}
