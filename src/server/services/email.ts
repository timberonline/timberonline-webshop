import { money, CARRIER_LABEL } from "../../lib/format";
import type { Ctx } from "./context";
import type { OrderForEmail } from "./types";

type Kind = "order_confirmation" | "shipped";

function esc(s: string | null | undefined) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, body: string) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F3F4F6;font-family:Inter,Arial,sans-serif;color:#0F2937;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:#0F2937;padding:20px 24px;color:#FFFFFF;font-weight:700;font-size:18px;letter-spacing:.5px">TIMBER <span style="font-weight:500">ONLINE</span></td></tr>
<tr><td style="padding:24px">${body}</td></tr>
<tr><td style="padding:16px 24px;background:#F3F4F6;color:#374151;font-size:13px">Timber Online · Vragen? Beantwoord deze e-mail.</td></tr>
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

export function renderEmail(kind: Kind, o: OrderForEmail) {
  if (kind === "order_confirmation") {
    const subject = `Bevestiging van je bestelling ${o.number}`;
    const html = layout(
      subject,
      `<h1 style="font-size:22px;margin:0 0 8px">Bedankt voor je bestelling</h1>
<p style="margin:0 0 8px">We hebben je betaling ontvangen. Bestelnummer: <strong>${esc(o.number)}</strong>.</p>
${linesTable(o)}
<p style="margin:0 0 8px"><strong>Bezorgadres</strong><br>${address(o)}</p>
<p style="margin:0 0 8px">${esc(o.delivery_promise)}</p>
<p style="margin:0;color:#374151">${o.tracking_promised ? "Zodra je zending is overgedragen aan de vervoerder, ontvang je een e-mail met de track &amp; trace-code." : "Je bestelling gaat als briefpost zonder track &amp; trace. We mailen je zodra de brief is gepost."}</p>`,
    );
    const text = `Bedankt voor je bestelling ${o.number}.\n\n${o.lines.map((l) => `${l.qty} x ${l.title}: ${money(l.line_total_cents)}`).join("\n")}\nVerzending: ${o.shipping_cents ? money(o.shipping_cents) : "Gratis"}\nTotaal: ${money(o.total_cents)}\n\n${o.delivery_promise ?? ""}`;
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
  const html = layout(subject, `<h1 style="font-size:22px;margin:0 0 8px">Je bestelling is onderweg</h1><p>Bestelnummer <strong>${esc(o.number)}</strong> is overgedragen aan ${esc(carrier)}.</p>${tracking}`);
  const text = `Je bestelling ${o.number} is onderweg met ${carrier}.${s?.tracking_code ? `\nTrack & trace: ${s.tracking_code}${s.tracking_url ? `\n${s.tracking_url}` : ""}` : ""}`;
  return { subject, html, text };
}

/** Verstuurt hooguit één bericht per order en soort; mislukte pogingen kunnen veilig opnieuw. */
export async function sendOrderEmail(ctx: Ctx, orderId: string, kind: Kind) {
  const order = await ctx.db.rpc<OrderForEmail | null>("api_order_for_email", { order_id: orderId });
  if (!order || order.channel !== "web" || !order.email) return { sent: false, reason: "geen webshoporder of e-mailadres" };
  if (kind === "order_confirmation" && order.stock_status !== "committed") return { sent: false, reason: "voorraad niet afgeboekt" };
  const claim = await ctx.db.rpc<{ claimed: boolean; id: string }>("api_email_claim", { order_id: orderId, kind, to: order.email });
  if (!claim.claimed) return { sent: false, reason: "al verstuurd" };
  try {
    const msg = renderEmail(kind, order);
    const res = await ctx.mail.send({ ...msg, to: order.email, idempotencyKey: `${kind}:${orderId}` });
    await ctx.db.rpc("api_email_complete", { id: claim.id, status: res.status, provider_id: res.providerId });
    return { sent: true, status: res.status };
  } catch (e) {
    await ctx.db.rpc("api_email_complete", { id: claim.id, status: "failed", error: (e as Error).message });
    return { sent: false, reason: (e as Error).message };
  }
}
