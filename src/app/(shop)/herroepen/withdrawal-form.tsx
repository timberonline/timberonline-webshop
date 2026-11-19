"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { WITHDRAWAL_LABELS } from "@/lib/legal";
import type { WithdrawalField, WithdrawalValues } from "@/server/services/withdrawal";
import { withdrawalAction, type WithdrawalFormState } from "./actions";

const EMPTY: WithdrawalValues = { name: "", email: "", order_number: "", scope: "all", items: "", note: "" };
const INITIAL: WithdrawalFormState = { status: "idle", errors: {}, values: EMPTY, seq: 0 };
const ORDER: WithdrawalField[] = ["name", "order_number", "email", "scope", "items", "note"];
const fid = (f: WithdrawalField) => `herroep-${f}`;

const dateTimeNl = (iso: string) =>
  new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "long", timeStyle: "medium" }).format(new Date(iso));

export function WithdrawalForm() {
  const [state, formAction, pending] = useActionState(withdrawalAction, INITIAL);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [values, setValues] = useState<WithdrawalValues>(EMPTY);
  const [clientErrors, setClientErrors] = useState<Partial<Record<WithdrawalField, string>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<WithdrawalField, string>>>({});
  // Eén sleutel per ingevuld formulier: opnieuw indienen na een fout maakt geen tweede herroeping.
  const [submissionKey] = useState(() => crypto.randomUUID());
  const focusRef = useRef<HTMLDivElement>(null);

  // Serverfouten: terug naar stap 1 met de ingevulde waarden.
  useEffect(() => {
    if (state.seq === 0) return;
    if (state.status === "invalid") {
      setValues(state.values);
      setServerErrors(state.errors);
      setStep("form");
    }
    focusRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (step === "confirm") focusRef.current?.focus();
  }, [step]);

  if (state.status === "received") {
    return (
      <div ref={focusRef} tabIndex={-1} role="status" className="notice notice-ok" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: "1.125rem", marginTop: 0 }}>Je herroeping is ontvangen</h2>
        {state.reference ? (
          <p style={{ margin: "0 0 6px" }}>
            Referentie <strong>{state.reference}</strong>
            {state.submittedAt ? <>, ontvangen op {dateTimeNl(state.submittedAt)}</> : null}.
          </p>
        ) : null}
        <p style={{ margin: 0 }}>
          {state.acknowledged === false
            ? "De bevestigingsmail kon nog niet worden verstuurd; we sturen hem zo snel mogelijk. Je herroeping is wel vastgelegd."
            : "We hebben een ontvangstbevestiging gestuurd naar het e-mailadres dat je hebt opgegeven. Daarin staat ook hoe je de artikelen terugstuurt."}
        </p>
      </div>
    );
  }

  const errors = step === "form" ? { ...serverErrors, ...clientErrors } : {};
  const set = (f: WithdrawalField) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f]: e.target.value }));
  const describedBy = (f: WithdrawalField, hint?: boolean) => [hint ? `${fid(f)}-hint` : null, errors[f] ? `${fid(f)}-error` : null].filter(Boolean).join(" ") || undefined;
  const err = (f: WithdrawalField) =>
    errors[f] ? (
      <p id={`${fid(f)}-error`} className="field-error">
        <span className="sr-only">Fout: </span>
        {errors[f]}
      </p>
    ) : null;
  const label = (f: WithdrawalField, text: string, required: boolean): ReactNode => (
    <label htmlFor={fid(f)}>
      {text}
      {required ? <span className="req" aria-hidden="true"> *</span> : <span className="optional"> (optioneel)</span>}
    </label>
  );

  // Stap 1 → 2: alleen eenvoudige controle in de browser; de server controleert alles opnieuw.
  const review = () => {
    const e: Partial<Record<WithdrawalField, string>> = {};
    if (!values.name.trim()) e.name = "Vul je naam in.";
    if (!values.order_number.trim()) e.order_number = "Vul je bestelnummer in.";
    if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) e.email = "Vul een geldig e-mailadres in, bijvoorbeeld naam@voorbeeld.nl.";
    if (values.scope === "partial" && !values.items.trim()) e.items = "Vermeld welke artikelen je herroept.";
    setClientErrors(e);
    setServerErrors({});
    if (Object.keys(e).length) {
      focusRef.current?.focus();
      return;
    }
    setStep("confirm");
  };

  const list = ORDER.filter((f) => errors[f]);
  const summary =
    list.length || state.status === "rate_limited" || state.status === "failed" ? (
      <div ref={focusRef} tabIndex={-1} role="alert" className="notice notice-danger error-summary">
        {state.status === "rate_limited" ? (
          "Er zijn kort na elkaar meerdere herroepingen verstuurd vanaf deze verbinding. Probeer het later opnieuw of mail ons."
        ) : state.status === "failed" && !list.length ? (
          "Je herroeping kon niet worden verwerkt. Probeer het opnieuw of mail ons je herroeping."
        ) : (
          <>
            <h3>Controleer het formulier</h3>
            <ul>
              {list.map((f) => (
                <li key={f}>
                  <a href={`#${fid(f)}`}>{errors[f]}</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    ) : (
      <div ref={focusRef} tabIndex={-1} />
    );

  if (step === "confirm") {
    return (
      // Eigen key per stap: anders hergebruikt React invoervelden van stap 1 (en zou het verborgen controleveld een waarde houden).
      <form key="bevestigen" action={formAction} style={{ marginTop: 16 }} aria-labelledby="herroep-controle">
        {summary}
        <h2 id="herroep-controle" style={{ fontSize: "1.125rem" }}>Controleer en bevestig je herroeping</h2>
        <dl className="dl">
          <dt>Naam</dt>
          <dd>{values.name}</dd>
          <dt>Bestelnummer</dt>
          <dd>{values.order_number.toUpperCase()}</dd>
          <dt>Bevestiging naar</dt>
          <dd>{values.email}</dd>
          <dt>Herroeping van</dt>
          <dd>{values.scope === "all" ? "De hele bestelling" : `Een deel: ${values.items}`}</dd>
          {values.note.trim() ? (
            <>
              <dt>Toelichting</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{values.note}</dd>
            </>
          ) : null}
        </dl>
        {ORDER.map((f) => (
          <input key={f} type="hidden" name={f} value={values[f]} />
        ))}
        <input type="hidden" name="submission_key" value={submissionKey} />
        <div className="hp-field" aria-hidden="true">
          <label htmlFor="herroep-website">Laat dit veld leeg</label>
          <input id="herroep-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <p className="small">Met de knop hieronder herroep je de overeenkomst. Je ontvangt direct een ontvangstbevestiging per e-mail.</p>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Bezig…" : WITHDRAWAL_LABELS.confirm}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setStep("form")} disabled={pending}>
            Gegevens wijzigen
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      key="invullen"
      noValidate
      style={{ marginTop: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        review();
      }}
      aria-describedby="herroep-verplicht"
    >
      {summary}
      <p id="herroep-verplicht" className="small muted">
        Velden met een sterretje (*) zijn verplicht.
      </p>
      <div className="field">
        {label("name", "Naam", true)}
        <input id={fid("name")} name="name" type="text" autoComplete="name" required value={values.name} onChange={set("name")} aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("name")} />
        {err("name")}
      </div>
      <div className="field">
        {label("order_number", "Bestelnummer", true)}
        <input id={fid("order_number")} name="order_number" type="text" required value={values.order_number} onChange={set("order_number")} aria-invalid={Boolean(errors.order_number)} aria-describedby={describedBy("order_number", true)} />
        <p id={`${fid("order_number")}-hint`} className="small muted">Staat in je orderbevestiging, bijvoorbeeld TO100001.</p>
        {err("order_number")}
      </div>
      <div className="field">
        {label("email", "E-mailadres voor de bevestiging", true)}
        <input id={fid("email")} name="email" type="email" autoComplete="email" required value={values.email} onChange={set("email")} aria-invalid={Boolean(errors.email)} aria-describedby={describedBy("email", true)} />
        <p id={`${fid("email")}-hint`} className="small muted">Gebruik bij voorkeur het e-mailadres van je bestelling; zo vinden we je bestelling direct.</p>
        {err("email")}
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend style={{ fontWeight: 600 }}>Wat wil je herroepen?</legend>
        <label className="check">
          <input type="radio" name="scope" value="all" checked={values.scope === "all"} onChange={set("scope")} /> De hele bestelling
        </label>
        <label className="check">
          <input type="radio" name="scope" value="partial" checked={values.scope === "partial"} onChange={set("scope")} /> Een deel van de bestelling
        </label>
      </fieldset>
      {values.scope === "partial" ? (
        <div className="field">
          {label("items", "Welke artikelen?", true)}
          <textarea id={fid("items")} name="items" rows={3} value={values.items} onChange={set("items")} aria-invalid={Boolean(errors.items)} aria-describedby={describedBy("items")} />
          {err("items")}
        </div>
      ) : null}
      <div className="field">
        {label("note", "Toelichting", false)}
        <textarea id={fid("note")} name="note" rows={3} value={values.note} onChange={set("note")} aria-describedby={describedBy("note")} />
        {err("note")}
      </div>
      <button type="submit" className="btn">
        Verder naar bevestigen
      </button>
    </form>
  );
}
