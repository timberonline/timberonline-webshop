"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

export function PasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const a = String(fd.get("password") ?? "");
    const b = String(fd.get("confirm") ?? "");
    if (a.length < 12) return setError("Gebruik minimaal 12 tekens.");
    if (a !== b) return setError("De wachtwoorden zijn niet gelijk.");
    const supabase = browserSupabase();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: a });
    setBusy(false);
    if (error) return setError("Opslaan mislukt. Vraag een nieuwe link aan.");
    router.replace("/beheer/mfa");
  }
  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="password">Nieuw wachtwoord</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <p className="field-hint">Minimaal 12 tekens.</p>
      </div>
      <div className="field">
        <label htmlFor="confirm">Herhaal wachtwoord</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {error ? (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-block" disabled={busy}>
        Opslaan
      </button>
    </form>
  );
}
