"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";

type State = { kind: "loading" } | { kind: "verify"; factorId: string } | { kind: "enroll"; factorId: string; qr: string; secret: string } | { kind: "error"; message: string };

export function MfaForm() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = browserSupabase();
    if (!supabase) return;
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        router.replace("/beheer/login");
        return;
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        router.replace("/beheer");
        return;
      }
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setState({ kind: "error", message: "Factoren konden niet worden geladen." });
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setState({ kind: "verify", factorId: verified.id });
      for (const f of data.all.filter((f) => f.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const enroll = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Timber Online ${new Date().toISOString().slice(0, 10)}` });
      if (enroll.error || !enroll.data) return setState({ kind: "error", message: "Inschrijven voor tweestapsverificatie mislukt." });
      setState({ kind: "enroll", factorId: enroll.data.id, qr: enroll.data.totp.qr_code, secret: enroll.data.totp.secret });
    })();
  }, [router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind !== "verify" && state.kind !== "enroll") return;
    const supabase = browserSupabase();
    if (!supabase) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code });
    setBusy(false);
    if (error) return setError("Code onjuist of verlopen. Probeer de volgende code.");
    router.replace("/beheer");
  }

  if (state.kind === "loading") return <p role="status">Laden…</p>;
  if (state.kind === "error") return <p className="notice notice-danger">{state.message}</p>;
  return (
    <form onSubmit={submit}>
      {state.kind === "enroll" ? (
        <>
          <p>Scan deze QR-code met een authenticator-app (bijv. 1Password, Google Authenticator) en vul de code van 6 cijfers in.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.qr} alt="QR-code voor tweestapsverificatie" width={180} height={180} style={{ background: "#fff", margin: "0 auto 12px" }} />
          <p className="small muted">
            Kun je niet scannen? Gebruik deze sleutel: <code style={{ wordBreak: "break-all" }}>{state.secret}</code>
          </p>
        </>
      ) : (
        <p>Vul de code van 6 cijfers uit je authenticator-app in.</p>
      )}
      <div className="field">
        <label htmlFor="code">Verificatiecode</label>
        <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
      </div>
      {error ? (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-block" disabled={busy}>
        {busy ? "Controleren…" : "Bevestigen"}
      </button>
    </form>
  );
}
