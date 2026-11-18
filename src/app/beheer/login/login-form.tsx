"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "reset">("login");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const supabase = browserSupabase();
    if (!supabase) return;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/beheer/auth/callback?next=/beheer/wachtwoord`,
      });
      setBusy(false);
      if (error) setError("Versturen mislukt. Probeer het later opnieuw.");
      else setInfo("Als dit adres bij een beheerder hoort, ontvang je een e-mail met een link om je wachtwoord in te stellen.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: String(fd.get("password") ?? "") });
    setBusy(false);
    if (error) {
      setError("Inloggen mislukt. Controleer je e-mailadres en wachtwoord.");
      return;
    }
    router.replace("/beheer/mfa");
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="email">E-mailadres</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      {mode === "login" ? (
        <div className="field">
          <label htmlFor="password">Wachtwoord</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      ) : null}
      {error ? (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="notice notice-ok" role="status">
          {info}
        </p>
      ) : null}
      <button className="btn btn-block" type="submit" disabled={busy}>
        {mode === "login" ? (busy ? "Bezig…" : "Inloggen") : busy ? "Versturen…" : "Stuur link"}
      </button>
      <p style={{ marginTop: 12 }}>
        <button type="button" className="link-btn" onClick={() => setMode(mode === "login" ? "reset" : "login")}>
          {mode === "login" ? "Wachtwoord instellen of vergeten?" : "Terug naar inloggen"}
        </button>
      </p>
    </form>
  );
}
