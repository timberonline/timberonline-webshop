import { money, CARRIER_LABEL } from "../../lib/format";
import { WITHDRAWAL_DAYS, WITHDRAWAL_LABELS, WITHDRAWAL_PATH, modelWithdrawalForm, policy } from "../../lib/legal";
import { addressLine, sellerName, type SellerSnapshot } from "./business";
import type { Ctx } from "./context";
import type { OrderForEmail } from "./types";
import { footerText } from "./withdrawal";

type Kind = "order_confirmation" | "shipped";

function esc(s: string | null | undefined) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, body: string, seller?: SellerSnapshot | null) {
  const footer = seller?.business ? esc(footerText(seller.business)) : "Timber Online";
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F3F4F6;font-family:Inter,Arial,sans-serif;color:#0F2937;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:#0F2937;padding:20px 24px;color:#FFFFFF;font-weight:700;font-size:18px;letter-spacing:.5px">TIMBER <span style="font-weight:500">ONLINE</span></td></tr>
<tr><td style="padding:24px">${body}</td></tr>
<tr><td style="padding:16px 24px;background:#F3F4F6;color:#374151;font-size:13px">Vragen? Beantwoord deze e-mail.<br>${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function linesTable(o: OrderForEmail) {
  const rows = o.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0">${l.qty} × ${esc(l.title)}${l.discount_cents ? `<br><span style="color:#374151;font-size:13px">Korting −${money(l.discount_cents)}</span>` : ""}</td><td align="right" style="padding:6px 0;white-space:nowrap">${money(l.line_total_cents)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #D1D5DB;border-bottom:1px solid #D1D5DB;margin:16px 0">${rows}
<tr><td style="padding:6px 0;color:#374151">Verzending</td><td align="right" style="color:#374151">${o.shipping_cents ? money(o.shipping_cents) : "Gratis"}</td></tr>
<tr><td style="padding:6px 0;font-weight:700">Totaal</td><td align="right" style="font-weight:700">${money(o.total_cents)}</td></tr></table>`;
}

function address(o: OrderForEmail) {
  const a = o.address;
  return [o.customer_name, [a.street, a.house_number].filter(Boolean).join(" "), a.extra, [a.postal_code, a.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .map((l) => esc(l))
    .join("<br>");
}

/** Herroepingsinformatie en modelformulier in de orderbevestiging (duurzame gegevensdrager, art. 6:230v lid 7 BW). */
function withdrawalSection(o: OrderForEmail, appUrl: string) {
  const b = o.seller?.business ?? {};
  const ret = o.seller?.return_address ?? {};
  const form = modelWithdrawalForm(b, ret);
  const retLine = ret.street ? `${ret.name ?? sellerName(b)}, ${addressLine(ret)}` : null;
  const html = `<h2 style="font-size:16px;margin:20px 0 6px">Bedenktijd en herroepen</h2>
<p style="margin:0 0 8px">Je hebt ${WITHDRAWAL_DAYS} dagen bedenktijd. Die gaat in op de dag na ontvangst van je bestelling (bij levering in delen: na ontvangst van het laatste deel). Herroepen kan zonder opgave van redenen via <a href="${esc(appUrl + WITHDRAWAL_PATH)}">${esc(WITHDRAWAL_LABELS.entry)}</a>, met het modelformulier hieronder of met een andere duidelijke verklaring aan ons.</p>
<p style="margin:0 0 8px">Stuur de artikelen uiterlijk ${WITHDRAWAL_DAYS} dagen na je herroeping terug${retLine ? ` naar ${esc(retLine)}` : ""}. ${esc(policy("return_costs").proposal)} We betalen het bedrag inclusief de standaard verzendkosten binnen ${WITHDRAWAL_DAYS} dagen na je herroeping terug, met hetzelfde betaalmiddel. We mogen wachten tot we de artikelen terug hebben of je aantoont dat je ze hebt teruggestuurd. Je bent aansprakelijk voor waardevermindering door een behandeling die verder gaat dan nodig om het artikel te bekijken; een aangebrachte screenprotector is gebruikt.</p>
<p style="margin:0 0 8px">Algemene voorwaarden: <a href="${esc(appUrl)}/info/voorwaarden">${esc(appUrl)}/info/voorwaarden</a> · Garantie en klachten: <a href="${esc(appUrl)}/info/garantie">${esc(appUrl)}/info/garantie</a></p>
<div style="border:1px solid #D1D5DB;border-radius:10px;padding:12px;font-size:13px;margin:8px 0 0">
<strong>Modelformulier voor herroeping</strong><br>${esc(form.intro)}<br><br>Aan: ${form.to.map(esc).join("<br>")}<br><br>${form.lines.map((l) => `— ${esc(l)}`).join("<br>")}<br><br>${esc(form.footnote)}</div>`;
  const text = `Bedenktijd en herroepen\nJe hebt ${WITHDRAWAL_DAYS} dagen bedenktijd na ontvangst. Herroepen: ${appUrl}${WITHDRAWAL_PATH} of met het modelformulier hieronder.\nTerugsturen binnen ${WITHDRAWAL_DAYS} dagen na herroeping${retLine ? ` naar ${retLine}` : ""}. ${policy("return_costs").proposal}\nTerugbetaling binnen ${WITHDRAWAL_DAYS} dagen na herroeping, incl. standaard verzendkosten.\nVoorwaarden: ${appUrl}/info/voorwaarden\n\nModelformulier voor herroeping\n${form.intro}\nAan: ${form.to.join(", ")}\n${form.lines.map((l) => `- ${l}`).join("\n")}\n${form.footnote}`;
  return { html, text };
}

export function renderEmail(kind: Kind, o: OrderForEmail, appUrl = "") {
  if (kind === "order_confirmation") {
    const w = withdrawalSection(o, appUrl);
    const seller = o.seller?.business;
    const sellerHtml = seller ? `<p style="margin:0 0 8px;color:#374151;font-size:14px">Verkoper: ${esc(sellerName(seller))}${addressLine(seller) ? `, ${esc(addressLine(seller))}` : ""}${seller.email ? ` · ${esc(seller.email)}` : ""}${seller.phone ? ` · ${esc(seller.phone)}` : ""}</p>` : "";
    const subject = `Bevestiging van je bestelling ${o.number}`;
    const html = layout(
      subject,
      `<h1 style="font-size:22px;margin:0 0 8px">Bedankt voor je bestelling</h1>
<p style="margin:0 0 8px">We hebben je betaling ontvangen. Bestelnummer: <strong>${esc(o.number)}</strong>.</p>
${linesTable(o)}
<p style="margin:0 0 8px"><strong>Bezorgadres</strong><br>${address(o)}</p>
<p style="margin:0 0 8px">${esc(o.delivery_promise)}</p>
<p style="margin:0;color:#374151">${o.tracking_promised ? "Zodra je zending is overgedragen aan de vervoerder, ontvang je een e-mail met de track &amp; trace-code." : "Je bestelling gaat als briefpost zonder track &amp; trace. We mailen je zodra de brief is gepost."}</p>
${sellerHtml}${w.html}`,
      o.seller,
    );
    const text = `Bedankt voor je bestelling ${o.number}.\n\n${o.lines.map((l) => `${l.qty} x ${l.title}: ${money(l.line_total_cents)}`).join("\n")}\nVerzending: ${o.shipping_cents ? money(o.shipping_cents) : "Gratis"}\nTotaal (incl. btw): ${money(o.total_cents)}\n\n${o.delivery_promise ?? ""}\n\n${w.text}\n\n${seller ? footerText(seller) : ""}`;
    return { subject, html, text };
  }
  const s = o.shipment;
  const carrier = CARRIER_LABEL[s?.carrier ?? ""] ?? "de vervoerder";
  const subject = `Je bestelling ${o.number} is onderweg`;
  const tracking =
    s?.carrier === "letter"
      ? `<p>Je bestelling is als briefpost verstuurd. Briefpost heeft geen track &amp; trace; bezorging duurt meestal 1–3 werkdagen.</p>`
      : s?.tracking_code
        ? `<p>Vervoerder: <strong>${esc(carrier)}</strong><br>Track &amp; trace: <strong>${esc(s.tracking_code)}</strong></p>${s.tracking_url ? `<p><a href="${esc(s.tracking_url)}" style="display:inline-block;background:#0066FF;color:#FFFFFF;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">Volg je zending</a></p>` : ""}`
        : `<p>Vervoerder: <strong>${esc(carrier)}</strong></p>`;
  const back = `<p style="margin:16px 0 0;color:#374151;font-size:14px">Bedenktijd: je hebt ${WITHDRAWAL_DAYS} dagen na ontvangst om je bestelling te herroepen via <a href="${esc(appUrl + WITHDRAWAL_PATH)}">${esc(WITHDRAWAL_LABELS.entry)}</a>.</p>`;
  const html = layout(subject, `<h1 style="font-size:22px;margin:0 0 8px">Je bestelling is onderweg</h1><p>Bestelnummer <strong>${esc(o.number)}</strong> is overgedragen aan ${esc(carrier)}.</p>${tracking}${back}`, o.seller);
  const text = `Je bestelling ${o.number} is onderweg met ${carrier}.${s?.tracking_code ? `\nTrack & trace: ${s.tracking_code}${s.tracking_url ? `\n${s.tracking_url}` : ""}` : ""}\n\nBedenktijd: ${WITHDRAWAL_DAYS} dagen na ontvangst. Herroepen: ${appUrl}${WITHDRAWAL_PATH}\n\n${o.seller?.business ? footerText(o.seller.business) : ""}`;
  return { subject, html, text };
}

/** Verstuurt hooguit één bericht per order en soort; mislukte pogingen kunnen veilig opnieuw. */
export async function sendOrderEmail(ctx: Ctx, orderId: string, kind: Kind) {
  const order = await ctx.db.rpc<OrderForEmail | null>("api_order_for_email", { order_id: orderId });
  if (!order || order.channel !== "web" || !order.email) return { sent: false, reason: "geen webshoporder of e-mailadres" };
  if (kind === "order_confirmation" && order.stock_status !== "committed") return { sent: false, reason: "voorraad niet afgeboekt" };
  const claim = await ctx.db.rpc<{ claimed: boolean; id: string; token: string }>("api_email_claim", { order_id: orderId, kind, to: order.email });
  if (!claim.claimed) return { sent: false, reason: "al verstuurd of wordt verstuurd" };
  try {
    const msg = renderEmail(kind, order, ctx.appUrl);
    // Stabiele idempotentiesleutel: ook bij een herhaalde poging levert Resend het bericht maar één keer af.
    // Antwoorden gaan naar het webshopadres zoals vastgelegd bij de order.
    const replyTo = order.seller?.business?.email ?? undefined;
    const res = await ctx.mail.send({ ...msg, to: order.email, idempotencyKey: `${kind}:${orderId}`, ...(replyTo ? { replyTo } : {}) });
    await ctx.db.rpc("api_email_complete", { id: claim.id, token: claim.token, status: res.status, provider_id: res.providerId });
    return { sent: true, status: res.status };
  } catch (e) {
    await ctx.db.rpc("api_email_complete", { id: claim.id, token: claim.token, status: "failed", error: (e as Error).message });
    return { sent: false, reason: (e as Error).message };
  }
}
