import "server-only";
import { z } from "zod";
import { WITHDRAWAL_DAYS } from "../../lib/legal";
import type { MailDriver } from "../integrations/mail";
import { addressLine, sellerName, type BusinessInfo, type PostalAddress, type SellerSnapshot } from "./business";
import { contactRecipient, type RateLimiter } from "./contact";

/**
 * Online herroepingsfunctie (art. 11a Richtlijn 2011/83/EU). De consument vult naam, ordernummer en het e-mailadres voor
 * de bevestiging in, bevestigt, en krijgt direct een ontvangstbevestiging met inhoud, datum en tijd.
 */

export const WITHDRAWAL_FIELDS = ["name", "email", "order_number", "scope", "items", "note"] as const;
export type WithdrawalField = (typeof WITHDRAWAL_FIELDS)[number];
export type WithdrawalValues = Record<WithdrawalField, string>;
export type WithdrawalErrors = Partial<Record<WithdrawalField, string>>;
export const EMPTY_WITHDRAWAL: WithdrawalValues = { name: "", email: "", order_number: "", scope: "all", items: "", note: "" };

const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

export const WithdrawalSchema = z
  .object({
    name: z.string().transform(oneLine).pipe(z.string().min(1, "Vul je naam in.").max(120, "Je naam mag maximaal 120 tekens lang zijn.")),
    email: z
      .string()
      .trim()
      .min(1, "Vul het e-mailadres in waarop je de bevestiging wilt ontvangen.")
      .max(160, "Dit e-mailadres is te lang.")
      .pipe(z.email("Vul een geldig e-mailadres in, bijvoorbeeld naam@voorbeeld.nl.")),
    order_number: z
      .string()
      .transform((v) => oneLine(v).toUpperCase().replace(/\s/g, ""))
      .pipe(z.string().min(1, "Vul je bestelnummer in.").regex(/^[A-Z0-9-]{4,40}$/, "Een bestelnummer bestaat uit letters en cijfers, bijvoorbeeld TO100001.")),
    scope: z.enum(["all", "partial"], "Kies of je de hele bestelling of een deel herroept."),
    items: z.string().trim().max(1000, "Maximaal 1000 tekens."),
    note: z.string().trim().max(2000, "Maximaal 2000 tekens."),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "partial" && !v.items) ctx.addIssue({ code: "custom", path: ["items"], message: "Vermeld welke artikelen je herroept." });
  });
export type WithdrawalData = z.infer<typeof WithdrawalSchema>;

export function validateWithdrawal(input: WithdrawalValues): { ok: true; data: WithdrawalData } | { ok: false; errors: WithdrawalErrors } {
  const r = WithdrawalSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const errors: WithdrawalErrors = {};
  for (const issue of r.error.issues) {
    const f = issue.path[0] as WithdrawalField | undefined;
    if (f && !errors[f]) errors[f] = issue.message;
  }
  return { ok: false, errors };
}

function esc(s: string | null | undefined) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Datum en tijd in Nederlandse tijd, bijv. "19-11-2026 om 14:05:31". */
export function amsterdamDateTime(iso: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
  return `${date} om ${time}`;
}

export type WithdrawalRecord = {
  id: string;
  reference: string;
  order_number: string;
  name: string;
  email: string;
  scope: "all" | "partial";
  items: string | null;
  note: string | null;
  submitted_at: string;
};

/** Ontvangstbevestiging op een duurzame gegevensdrager: inhoud van de verklaring plus datum en tijd van indiening. */
export function renderWithdrawalAck(w: WithdrawalRecord, seller: SellerSnapshot | null, appUrl: string) {
  const b = seller?.business ?? {};
  const ret = seller?.return_address ?? {};
  const shop = sellerName(b);
  const when = amsterdamDateTime(w.submitted_at);
  const subject = `Ontvangstbevestiging herroeping ${w.reference} (bestelling ${w.order_number})`;
  const rows: [string, string][] = [
    ["Referentie", w.reference],
    ["Ontvangen op", when],
    ["Naam", w.name],
    ["Bestelnummer", w.order_number],
    ["Herroeping van", w.scope === "all" ? "De hele bestelling" : `Een deel van de bestelling: ${w.items ?? ""}`],
    ["Toelichting", w.note ?? "–"],
    ["Bevestiging naar", w.email],
  ];
  const retLine = ret.street ? `${ret.name ?? shop}, ${addressLine(ret)}` : null;
  const next = [
    `Stuur de artikelen binnen ${WITHDRAWAL_DAYS} dagen na vandaag terug${retLine ? ` naar: ${retLine}` : ""}. Vermeld je bestelnummer.`,
    `We betalen het aankoopbedrag, inclusief de standaard verzendkosten, binnen ${WITHDRAWAL_DAYS} dagen na vandaag terug met hetzelfde betaalmiddel. We mogen wachten met terugbetalen tot we de artikelen hebben ontvangen of je hebt aangetoond dat je ze hebt teruggestuurd.`,
    `Meer informatie: ${appUrl}/info/retourneren`,
  ];
  const footer = footerText(b);
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#F3F4F6;font-family:Inter,Arial,sans-serif;color:#0F2937;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px">
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 8px">We hebben je herroeping ontvangen</h1>
<p style="margin:0 0 12px">Dit is de bevestiging van je herroepingsverklaring bij ${esc(shop)}. Bewaar deze e-mail.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rows
    .map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#374151;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:2px 0;white-space:pre-wrap">${esc(v)}</td></tr>`)
    .join("")}</table>
<h2 style="font-size:16px;margin:0 0 6px">Hoe gaat het verder?</h2>
<ul style="margin:0 0 12px;padding-left:18px">${next.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
</td></tr>
<tr><td style="padding:16px 24px;background:#F3F4F6;color:#374151;font-size:13px">${esc(footer)}</td></tr>
</table></body></html>`;
  const text = `We hebben je herroeping ontvangen\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nHoe gaat het verder?\n${next.map((n) => `- ${n}`).join("\n")}\n\n${footer}\n`;
  return { subject, html, text };
}

/** Melding voor de webshop zelf (geen klantgegevens in de onderwerpregel). */
export function renderWithdrawalNotice(w: WithdrawalRecord, matched: boolean, appUrl: string) {
  const subject = `Herroeping ontvangen: ${w.reference} (${w.order_number})`;
  const text = `Er is een herroeping ontvangen via de website.\n\nReferentie: ${w.reference}\nOntvangen op: ${amsterdamDateTime(w.submitted_at)}\nBestelnummer: ${w.order_number}${matched ? "" : " (komt NIET overeen met een webshoporder met dit e-mailadres: handmatig nagaan)"}\nOmvang: ${w.scope === "all" ? "hele bestelling" : `deel: ${w.items ?? ""}`}\n\nAfhandelen in beheer: ${appUrl}/beheer/herroepingen\n`;
  const html = `<!doctype html><html lang="nl"><body style="font-family:Inter,Arial,sans-serif;color:#0F2937"><pre style="white-space:pre-wrap;font-family:inherit">${esc(text)}</pre></body></html>`;
  return { subject, html, text };
}

export function footerText(b: Partial<BusinessInfo>) {
  return [sellerName(b), addressLine(b), b.kvk ? `KvK ${b.kvk}` : null, b.vat_id ? `btw-id ${b.vat_id}` : null, b.email, b.phone].filter(Boolean).join(" · ");
}

type Db = { rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> };

export type WithdrawalResult =
  | { status: "invalid"; errors: WithdrawalErrors }
  | { status: "ignored" }
  | { status: "rate_limited" }
  | { status: "failed" }
  | { status: "received"; reference: string; submittedAt: string; acknowledged: boolean };

export async function submitWithdrawal(
  input: WithdrawalValues & { honeypot?: string },
  deps: { db: Db; mail: MailDriver; appUrl: string; clientKey: string; limiter: RateLimiter },
): Promise<WithdrawalResult> {
  if ((input.honeypot ?? "").trim() !== "") return { status: "ignored" };
  const v = validateWithdrawal(input);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  if (!(await deps.limiter.take(deps.clientKey))) return { status: "rate_limited" };
  let saved: { ok: boolean; id: string; reference: string; submitted_at: string };
  try {
    saved = await deps.db.rpc("api_withdrawal_submit", { ...v.data });
    if (!saved.ok) return { status: "failed" };
  } catch (e) {
    console.error("Herroeping vastleggen mislukt:", (e as Error).message);
    return { status: "failed" };
  }
  const acknowledged = await sendWithdrawalAck(deps, saved.id);
  return { status: "received", reference: saved.reference, submittedAt: saved.submitted_at, acknowledged };
}

/** Verstuurt de ontvangstbevestiging (hooguit één keer) en meldt de herroeping aan de webshop. Veilig te herhalen. */
export async function sendWithdrawalAck(deps: { db: Db; mail: MailDriver; appUrl: string }, id: string): Promise<boolean> {
  const claim = await deps.db.rpc<{ claimed: boolean; withdrawal?: WithdrawalRecord & { order_id: string | null }; seller?: SellerSnapshot }>(
    "api_withdrawal_ack_claim",
    { id },
  );
  if (!claim.claimed || !claim.withdrawal) return false;
  const w = claim.withdrawal;
  const seller = claim.seller ?? null;
  try {
    const msg = renderWithdrawalAck(w, seller, deps.appUrl);
    const res = await deps.mail.send({ ...msg, to: w.email, idempotencyKey: `withdrawal-ack:${w.id}`, replyTo: seller?.business?.email ?? undefined });
    await deps.db.rpc("api_withdrawal_ack_complete", { id: w.id, status: res.status, provider_id: res.providerId });
  } catch (e) {
    await deps.db.rpc("api_withdrawal_ack_complete", { id: w.id, status: "failed", error: (e as Error).message }).catch(() => undefined);
    return false;
  }
  // Interne melding (best effort; de herroeping staat hoe dan ook in beheer).
  const to = contactRecipient(process.env, seller?.business?.email ?? null);
  if (to) {
    const notice = renderWithdrawalNotice(w, Boolean(w.order_id), deps.appUrl);
    await deps.mail.send({ ...notice, to, idempotencyKey: `withdrawal-notice:${w.id}`, replyTo: w.email }).catch((e) => {
      console.error("Melding herroeping aan webshop mislukt:", (e as Error).message);
    });
  }
  return true;
}

export type { PostalAddress };
