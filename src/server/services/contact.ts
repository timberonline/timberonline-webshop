import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MailDriver, MailResult } from "../integrations/mail";

/** Onderwerpen van het contactformulier (waarde → label). */
export const CONTACT_SUBJECTS = {
  bestelling: "Vraag over mijn bestelling",
  levering: "Verzending en levering",
  retour: "Retourneren",
  product: "Vraag over een product",
  anders: "Iets anders",
} as const;
export type ContactSubject = keyof typeof CONTACT_SUBJECTS;

export const CONTACT_FIELDS = ["name", "email", "order", "subject", "message"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type ContactValues = Record<ContactField, string>;
export type ContactErrors = Partial<Record<ContactField, string>>;
/** Verborgen veld dat mensen niet zien en spambots wel invullen. */
export const HONEYPOT_FIELD = "website";
export type ContactInput = ContactValues & { [HONEYPOT_FIELD]: string };

export const EMPTY_CONTACT_VALUES: ContactValues = { name: "", email: "", order: "", subject: "", message: "" };

const SUBJECT_KEYS = Object.keys(CONTACT_SUBJECTS) as [ContactSubject, ...ContactSubject[]];

/** Eén regel tekst: geen regeleinden of stuurtekens (bijv. in naam of bestelnummer). */
function oneLine(s: string) {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

export const ContactSchema = z.object({
  name: z
    .string()
    .transform(oneLine)
    .pipe(z.string().min(1, "Vul je naam in.").max(100, "Je naam mag maximaal 100 tekens lang zijn.")),
  email: z
    .string()
    .trim()
    .min(1, "Vul je e-mailadres in.")
    .max(254, "Dit e-mailadres is te lang.")
    .pipe(z.email("Vul een geldig e-mailadres in, bijvoorbeeld naam@voorbeeld.nl.")),
  order: z
    .string()
    .transform(oneLine)
    .refine((v) => v === "" || /^[A-Za-z0-9-]{4,40}$/.test(v), "Een bestelnummer bestaat uit letters en cijfers, bijvoorbeeld TO100001."),
  subject: z.enum(SUBJECT_KEYS, "Kies een onderwerp."),
  message: z
    .string()
    .trim()
    .min(1, "Schrijf je bericht.")
    .min(10, "Je bericht is te kort: gebruik minimaal 10 tekens.")
    .max(5000, "Je bericht mag maximaal 5000 tekens lang zijn."),
});
export type ContactData = z.infer<typeof ContactSchema>;

/** Leest het formulier; ontbrekende of niet-tekstvelden worden lege tekst. */
export function contactInputFromFormData(fd: FormData): ContactInput {
  const get = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.slice(0, 10_000) : "";
  };
  return {
    name: get("name"),
    email: get("email"),
    order: get("order"),
    subject: get("subject"),
    message: get("message"),
    [HONEYPOT_FIELD]: get(HONEYPOT_FIELD),
  };
}

export function validateContact(input: ContactValues): { ok: true; data: ContactData } | { ok: false; errors: ContactErrors } {
  const parsed = ContactSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: ContactErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as ContactField | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

/**
 * Ontvanger van contactberichten: CONTACT_TO, anders het webshopadres uit de bedrijfsgegevens, anders MAIL_REPLY_TO.
 * Null = formulier nog niet actief.
 */
export function contactRecipient(source: Record<string, string | undefined> = process.env, businessEmail?: string | null): string | null {
  const own = source.CONTACT_TO?.trim();
  if (own) return own;
  if (businessEmail && z.email().safeParse(businessEmail).success) return businessEmail;
  return source.MAIL_REPLY_TO?.trim() || null;
}

/** Publiek e-mailadres voor klanten: het webshopadres uit de bedrijfsgegevens, anders NEXT_PUBLIC_CONTACT_EMAIL. */
export function publicContactEmail(source: Record<string, string | undefined> = process.env, businessEmail?: string | null): string | null {
  for (const v of [businessEmail?.trim(), source.NEXT_PUBLIC_CONTACT_EMAIL?.trim()]) {
    if (v && z.email().safeParse(v).success) return v;
  }
  return null;
}

/** Eenvoudige rate limit per sleutel (IP) in het geheugen van deze serverinstantie. */
export type RateLimiter = { take(key: string, now?: number): boolean | Promise<boolean> };

export function createRateLimiter({ limit, windowMs, maxKeys = 5000 }: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      hits.delete(key);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // Begrens het geheugen: oudste sleutel eruit.
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return true;
    },
  };
}

/**
 * Gedeelde limiet over alle serverinstanties heen (database, vast venster). De sleutel wordt gehasht opgeslagen,
 * nooit het IP-adres zelf. Valt bij een databasefout terug op de limiet van deze instantie.
 */
export function createSharedRateLimiter(
  db: { rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> },
  { limit, windowSeconds, scope }: { limit: number; windowSeconds: number; scope: string },
  fallback: RateLimiter = createRateLimiter({ limit, windowMs: windowSeconds * 1000 }),
): RateLimiter {
  return {
    async take(key, now) {
      const hashed = `${scope}:${createHash("sha256").update(`${scope}|${key}`).digest("hex").slice(0, 40)}`;
      try {
        const r = await db.rpc<{ allowed: boolean }>("api_rate_limit_take", { key: hashed, limit, window_seconds: windowSeconds });
        return r.allowed;
      } catch {
        return fallback.take(key, now);
      }
    },
  };
}

/** Standaard: hooguit 5 verzonden berichten per IP per 15 minuten. */
const defaultLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderContactEmail(d: ContactData) {
  const topic = CONTACT_SUBJECTS[d.subject];
  // Geen naam of e-mailadres in de onderwerpregel.
  const subject = `Contactformulier: ${topic}${d.order ? ` (${d.order})` : ""}`;
  const rows: [string, string][] = [
    ["Naam", esc(d.name)],
    ["E-mail", `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`],
    ["Bestelnummer", d.order ? esc(d.order) : "–"],
    ["Onderwerp", esc(topic)],
  ];
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#F3F4F6;font-family:Inter,Arial,sans-serif;color:#0F2937;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px">
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">Nieuw bericht via het contactformulier</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rows
    .map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#374151;vertical-align:top">${k}</td><td style="padding:2px 0">${v}</td></tr>`)
    .join("")}</table>
<div style="white-space:pre-wrap;border-top:1px solid #D1D5DB;padding-top:12px">${esc(d.message)}</div>
<p style="margin:16px 0 0;color:#374151;font-size:13px">Antwoord de klant via het e-mailadres hierboven.</p>
</td></tr></table></body></html>`;
  const text = `Nieuw bericht via het contactformulier\n\nNaam: ${d.name}\nE-mail: ${d.email}\nBestelnummer: ${d.order || "-"}\nOnderwerp: ${topic}\n\n${d.message}\n`;
  return { subject, html, text };
}

export type ContactResult =
  | { status: "invalid"; errors: ContactErrors }
  /** Honeypot ingevuld: niets versturen, maar de afzender ziet een gewone bevestiging. */
  | { status: "ignored" }
  | { status: "inactive" }
  | { status: "rate_limited" }
  | { status: "sent"; delivery: MailResult["status"] }
  | { status: "failed" };

export type ContactDeps = {
  mail: MailDriver;
  /** Ontvanger; standaard via contactRecipient(). */
  recipient?: string | null;
  /** Sleutel voor de rate limit, meestal het IP-adres. */
  clientKey: string;
  limiter?: RateLimiter;
  now?: number;
};

/** Valideert en verstuurt een contactbericht via de bestaande mailintegratie (MAIL_MODE simulated/resend). */
export async function submitContact(input: ContactInput, deps: ContactDeps): Promise<ContactResult> {
  if (input[HONEYPOT_FIELD].trim() !== "") return { status: "ignored" };
  const v = validateContact(input);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const recipient = deps.recipient === undefined ? contactRecipient() : deps.recipient;
  if (!recipient) return { status: "inactive" };
  if (!(await (deps.limiter ?? defaultLimiter).take(deps.clientKey, deps.now))) return { status: "rate_limited" };
  const msg = renderContactEmail(v.data);
  // Dezelfde inhoud twee keer verzenden (dubbelklik, herhaalpoging) levert bij Resend één bericht op.
  const idempotencyKey = `contact:${createHash("sha256").update(JSON.stringify(v.data)).digest("hex").slice(0, 40)}`;
  try {
    const res = await deps.mail.send({ ...msg, to: recipient, idempotencyKey, replyTo: v.data.email });
    return { status: "sent", delivery: res.status };
  } catch (e) {
    // Alleen de foutmelding van de mailprovider loggen, nooit de inhoud of gegevens van de afzender.
    console.error("Contactformulier: verzenden mislukt:", e instanceof Error ? e.message : "onbekende fout");
    return { status: "failed" };
  }
}
