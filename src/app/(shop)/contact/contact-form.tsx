"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ContactField } from "@/server/services/contact";
import { contactAction, type ContactFormState } from "./actions";

const INITIAL: ContactFormState = {
  status: "idle",
  errors: {},
  values: { name: "", email: "", order: "", subject: "", message: "" },
  seq: 0,
};

const ORDER: ContactField[] = ["name", "email", "order", "subject", "message"];

const fieldId = (f: ContactField) => `contact-${f}`;

function MailLink({ email }: { email: string }) {
  return <a href={`mailto:${email}`}>{email}</a>;
}

export function ContactForm({ subjects, contactEmail }: { subjects: { value: string; label: string }[]; contactEmail: string | null }) {
  const [state, formAction, pending] = useActionState(contactAction, INITIAL);
  const messageRef = useRef<HTMLDivElement>(null);
  const { errors, values, status, seq } = state;

  // Na elke inzending de focus naar de foutsamenvatting of de uitkomst, zodat toetsenbord- en schermlezergebruikers die direct horen.
  useEffect(() => {
    if (seq > 0) messageRef.current?.focus();
  }, [seq]);

  const describedBy = (f: ContactField, hint?: boolean) =>
    [hint ? `${fieldId(f)}-hint` : null, errors[f] ? `${fieldId(f)}-error` : null].filter(Boolean).join(" ") || undefined;

  const errorText = (f: ContactField) =>
    errors[f] ? (
      <p id={`${fieldId(f)}-error`} className="field-error">
        <span className="sr-only">Fout: </span>
        {errors[f]}
      </p>
    ) : null;

  const label = (f: ContactField, text: string, required: boolean): ReactNode => (
    <label htmlFor={fieldId(f)}>
      {text}
      {required ? (
        <span className="req" aria-hidden="true">
          {" "}
          *
        </span>
      ) : (
        <span className="optional"> (optioneel)</span>
      )}
    </label>
  );

  let alert: ReactNode = null;
  if (status === "invalid") {
    const list = ORDER.filter((f) => errors[f]);
    alert = (
      <div key={seq} ref={messageRef} tabIndex={-1} className="notice notice-danger error-summary">
        <h3>Controleer het formulier</h3>
        <ul>
          {list.map((f) => (
            <li key={f}>
              <a
                href={`#${fieldId(f)}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(fieldId(f))?.focus();
                }}
              >
                {errors[f]}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (status === "inactive") {
    alert = (
      <div key={seq} ref={messageRef} tabIndex={-1} className="notice notice-warn">
        Het contactformulier is nog niet actief, dus je bericht is niet verstuurd.{" "}
        {contactEmail ? (
          <>
            Mail je vraag naar <MailLink email={contactEmail} />.
          </>
        ) : (
          "Onze contactgegevens volgen binnenkort."
        )}
      </div>
    );
  } else if (status === "rate_limited") {
    alert = (
      <div key={seq} ref={messageRef} tabIndex={-1} className="notice notice-danger">
        Je hebt kort na elkaar meerdere berichten verstuurd. Probeer het over een kwartier opnieuw.
      </div>
    );
  } else if (status === "failed") {
    alert = (
      <div key={seq} ref={messageRef} tabIndex={-1} className="notice notice-danger">
        Je bericht kon niet worden verstuurd. Probeer het later opnieuw
        {contactEmail ? (
          <>
            {" "}
            of mail naar <MailLink email={contactEmail} />
          </>
        ) : null}
        .
      </div>
    );
  }

  return (
    <>
      <div role="status" aria-live="polite" className="form-status">
        {status === "sent" ? (
          <div key={seq} ref={messageRef} tabIndex={-1} className="notice notice-ok">
            Bedankt voor je bericht. We hebben het ontvangen en nemen zo snel mogelijk contact met je op.
            {state.simulated ? " (Testomgeving: de e-mail is gesimuleerd en niet echt verstuurd.)" : null}
          </div>
        ) : null}
      </div>
      <div role="alert" id="contact-meldingen" className="form-status">
        {alert}
      </div>

      {/* key: na elke inzending opnieuw opbouwen, zodat de teruggegeven waarden (ook van de keuzelijst) zichtbaar zijn. */}
      <form key={seq} action={formAction} noValidate className="contact-form" aria-describedby="contact-verplicht">
        <p id="contact-verplicht" className="small muted">
          Velden met een sterretje (*) zijn verplicht.
        </p>

        <div className="field">
          {label("name", "Naam", true)}
          <input
            id={fieldId("name")}
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={100}
            defaultValue={values.name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("name")}
          />
          {errorText("name")}
        </div>

        <div className="field">
          {label("email", "E-mailadres", true)}
          <input
            id={fieldId("email")}
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            required
            maxLength={254}
            defaultValue={values.email}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy("email", true)}
          />
          <p id={`${fieldId("email")}-hint`} className="field-hint">
            We gebruiken je e-mailadres alleen om je vraag te beantwoorden.
          </p>
          {errorText("email")}
        </div>

        <div className="field">
          {label("order", "Bestelnummer", false)}
          <input
            id={fieldId("order")}
            name="order"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            defaultValue={values.order}
            aria-invalid={errors.order ? true : undefined}
            aria-describedby={describedBy("order", true)}
          />
          <p id={`${fieldId("order")}-hint`} className="field-hint">
            Staat in je bevestigingsmail, bijvoorbeeld TO100001.
          </p>
          {errorText("order")}
        </div>

        <div className="field">
          {label("subject", "Onderwerp", true)}
          <select
            id={fieldId("subject")}
            name="subject"
            required
            defaultValue={values.subject}
            aria-invalid={errors.subject ? true : undefined}
            aria-describedby={describedBy("subject")}
          >
            <option value="">Kies een onderwerp</option>
            {subjects.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {errorText("subject")}
        </div>

        <div className="field">
          {label("message", "Bericht", true)}
          <textarea
            id={fieldId("message")}
            name="message"
            rows={6}
            required
            maxLength={5000}
            defaultValue={values.message}
            aria-invalid={errors.message ? true : undefined}
            aria-describedby={describedBy("message", true)}
          />
          <p id={`${fieldId("message")}-hint`} className="field-hint">
            Minimaal 10 tekens. Deel geen betaalgegevens of wachtwoorden.
          </p>
          {errorText("message")}
        </div>

        {/* Honeypot tegen spam: onzichtbaar en niet bereikbaar met het toetsenbord. */}
        <div className="hp-field" aria-hidden="true">
          <label htmlFor="contact-website">Laat dit veld leeg</label>
          <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Bezig met versturen…" : "Verstuur bericht"}
        </button>
      </form>
    </>
  );
}
