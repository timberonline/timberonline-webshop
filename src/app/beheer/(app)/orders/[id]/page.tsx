import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { randomUUID } from "node:crypto";
import { Flash, Status } from "../../_components/ui";
import { CARRIER_LABEL, dateTime, money } from "@/lib/format";
import { getDb } from "@/server/db";
import { cancelOrderAction, createReturnAction, decideReturnAction, refundAction, resendEmailAction, retryStockAction, updateAddressAction } from "../actions";

type Line = { id: string; sku: string; title: string; qty: number; unit_price_cents: number; discount_cents: number; line_total_cents: number; bol_order_item_id: string | null; stock_committed: boolean; returned_qty: number };
type Order = {
  id: string; number: string; channel: string; payment_status: string; stock_status: string; fulfillment_status: string;
  email: string | null; customer_name: string | null; phone: string | null; ship_street: string | null; ship_house_number: string | null;
  ship_address_extra: string | null; ship_postal_code: string | null; ship_city: string | null; ship_country: string | null;
  shipping_option: string; tracking_promised: boolean; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number;
  refunded_cents: number; payment_method: string | null; stripe_payment_intent_id: string | null; bol_order_id: string | null; ship_deadline: string | null;
  reserved_until: string | null; paid_at: string | null; created_at: string; needs_attention: boolean; attention_reason: string | null;
  address_problems: string[]; allowed_carriers: string[];
  lines: Line[];
  reservations: { code: string; qty: number; status: string; expires_at: string }[];
  shipments: { id: string; carrier: string; status: string; label_status: string; tracking_code: string | null; tracking_url: string | null; handed_over_at: string | null; handover_manual: boolean; exception_reason: string | null; events: { status: string; source: string; occurred_at: string }[] }[];
  emails: { kind: string; status: string; to_email: string; attempts: number; error: string | null; updated_at: string }[];
  refunds: { amount_cents: number; status: string; provider_refund_id: string | null; reason: string | null; created_by: string; created_at: string; error: string | null }[];
  returns: { id: string; status: string; note: string | null; created_at: string; lines: { id: string; sku: string; title: string; qty: number; decision: string; decided_by: string | null }[] }[];
  outbox: { kind: string; status: string; attempts: number; last_error: string | null }[];
  audit: { id: number; at: string; actor: string; action: string }[];
  now: string;
};

export default async function OrderPage({ params, searchParams }: PageProps<"/beheer/orders/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const o = await getDb().rpc<Order | null>("api_admin_order", { id });
  if (!o) notFound();
  const shipped = o.shipments.some((s) => ["handed_over", "in_transit", "ready_for_pickup", "delivered"].includes(s.status));
  const refundable = o.channel === "web" && !!o.stripe_payment_intent_id && o.total_cents - o.refunded_cents > 0;
  const returnable = o.lines.filter((l) => l.qty - l.returned_qty > 0);

  return (
    <>
      <div className="page-head">
        <h1>
          Order {o.number} <span className="badge">{o.channel === "bol" ? `bol ${o.bol_order_id}` : "webshop"}</span>
        </h1>
        <Link href="/beheer/orders">← Alle orders</Link>
      </div>
      <Flash sp={sp} />
      {o.needs_attention ? <p className="notice notice-warn">{o.attention_reason}</p> : null}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", marginBottom: 16 }}>
        <section className="card" aria-labelledby="status">
          <h2 id="status" style={{ fontSize: "1.125rem" }}>Status</h2>
          <dl className="dl">
            <dt>Betaling</dt>
            <dd><Status value={o.payment_status} /> {o.payment_method ? <span className="small muted">via {o.payment_method}</span> : null}</dd>
            <dt>Voorraad</dt>
            <dd><Status value={o.stock_status} /></dd>
            <dt>Verzending</dt>
            <dd><Status value={o.fulfillment_status} /></dd>
            <dt>Aangemaakt</dt>
            <dd>{dateTime(o.created_at)}</dd>
            {o.paid_at ? (<><dt>Betaald</dt><dd>{dateTime(o.paid_at)}</dd></>) : null}
            {o.payment_status === "pending" ? (<><dt>Gereserveerd tot</dt><dd>{dateTime(o.reserved_until)}</dd></>) : null}
            {o.ship_deadline ? (<><dt>Uiterste leverdatum</dt><dd>{dateTime(o.ship_deadline)}</dd></>) : null}
            <dt>Track & trace beloofd</dt>
            <dd>{o.tracking_promised ? "Ja" : "Nee (briefpost)"}</dd>
          </dl>
          {o.stock_status === "shortage" ? (
            <form action={retryStockAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="order_id" value={o.id} />
              <button className="btn btn-sm">Voorraad opnieuw toewijzen</button>
            </form>
          ) : null}
        </section>

        <section className="card" aria-labelledby="klant">
          <h2 id="klant" style={{ fontSize: "1.125rem" }}>Klant en adres</h2>
          <p style={{ margin: "0 0 8px" }}>
            {o.customer_name}<br />
            {[o.ship_street, o.ship_house_number].filter(Boolean).join(" ")}
            {o.ship_address_extra ? <><br />{o.ship_address_extra}</> : null}
            <br />{o.ship_postal_code} {o.ship_city} {o.ship_country && o.ship_country !== "NL" ? o.ship_country : ""}
            {o.email ? <><br /><a href={`mailto:${o.email}`}>{o.email}</a></> : null}
            {o.phone ? <><br />{o.phone}</> : null}
          </p>
          {o.address_problems.length ? <p className="notice notice-danger">Adresprobleem: {o.address_problems.join(", ")}</p> : null}
          <details>
            <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Adres corrigeren</summary>
            <form action={updateAddressAction}>
              <input type="hidden" name="order_id" value={o.id} />
              <div className="field"><label htmlFor="name">Naam</label><input id="name" name="name" type="text" defaultValue={o.customer_name ?? ""} /></div>
              <div className="row">
                <div className="field"><label htmlFor="street">Straat</label><input id="street" name="street" type="text" defaultValue={o.ship_street ?? ""} /></div>
                <div className="field" style={{ flex: "0 1 120px" }}><label htmlFor="house_number">Huisnummer</label><input id="house_number" name="house_number" type="text" defaultValue={o.ship_house_number ?? ""} /></div>
              </div>
              <div className="field"><label htmlFor="address_extra">Toevoeging / tweede regel</label><input id="address_extra" name="address_extra" type="text" defaultValue={o.ship_address_extra ?? ""} /></div>
              <div className="row">
                <div className="field" style={{ flex: "0 1 140px" }}><label htmlFor="postal_code">Postcode</label><input id="postal_code" name="postal_code" type="text" defaultValue={o.ship_postal_code ?? ""} /></div>
                <div className="field"><label htmlFor="city">Plaats</label><input id="city" name="city" type="text" defaultValue={o.ship_city ?? ""} /></div>
                <div className="field" style={{ flex: "0 1 90px" }}><label htmlFor="country">Land</label><input id="country" name="country" type="text" defaultValue={o.ship_country ?? "NL"} /></div>
              </div>
              <button className="btn btn-sm">Adres opslaan</button>
            </form>
          </details>
        </section>
      </div>

      <section className="table-wrap" aria-labelledby="regels" style={{ marginBottom: 16 }}>
        <h2 id="regels" className="sr-only">Orderregels</h2>
        <table className="data">
          <thead>
            <tr><th>Artikel</th><th className="r">Aantal</th><th className="r">Stukprijs</th><th className="r">Korting</th><th className="r">Totaal</th><th>Retour</th></tr>
          </thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.title}<div className="small muted">{l.sku}{l.bol_order_item_id ? ` · bol-item ${l.bol_order_item_id}` : ""}</div></td>
                <td className="r num">{l.qty}</td>
                <td className="r num">{money(l.unit_price_cents)}</td>
                <td className="r num">{l.discount_cents ? `−${money(l.discount_cents)}` : "–"}</td>
                <td className="r num">{money(l.line_total_cents)}</td>
                <td className="num">{l.returned_qty || "–"}</td>
              </tr>
            ))}
            <tr><td colSpan={4} className="r">Verzending ({o.shipping_option})</td><td className="r num">{money(o.shipping_cents)}</td><td /></tr>
            <tr><td colSpan={4} className="r"><strong>Totaal</strong></td><td className="r num"><strong>{money(o.total_cents)}</strong></td><td /></tr>
            {o.refunded_cents ? (<tr><td colSpan={4} className="r">Terugbetaald</td><td className="r num">−{money(o.refunded_cents)}</td><td /></tr>) : null}
          </tbody>
        </table>
      </section>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", marginBottom: 16 }}>
        <section className="card" aria-labelledby="zending">
          <h2 id="zending" style={{ fontSize: "1.125rem" }}>Zending</h2>
          {o.shipments.length === 0 ? (
            <p className="muted">Nog geen zending. <Link href="/beheer/verzendingen">Naar Verzendingen</Link></p>
          ) : (
            o.shipments.map((s) => (
              <div key={s.id} style={{ marginBottom: 12 }}>
                <p style={{ margin: "0 0 4px" }}>
                  {CARRIER_LABEL[s.carrier]} · <Status value={s.status} /> {s.tracking_code ? <span className="small">· {s.tracking_code}</span> : null}
                </p>
                {s.handed_over_at ? <p className="small muted" style={{ margin: 0 }}>Overgedragen {dateTime(s.handed_over_at)}{s.handover_manual ? " (handmatig bevestigd)" : " (scan vervoerder)"}</p> : null}
                {s.exception_reason ? <p className="small stock-none" style={{ margin: 0 }}>{s.exception_reason}</p> : null}
                {s.label_status === "ready" ? <a className="small" href={`/beheer/label/${s.id}`}>Label downloaden (PDF)</a> : null}
                {s.events.length ? (
                  <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {s.events.map((e, i) => (<li key={i}>{dateTime(e.occurred_at)} · {e.status} · {e.source}</li>))}
                  </ul>
                ) : null}
              </div>
            ))
          )}
          {o.outbox.map((ob, i) => (
            <p key={i} className="small" style={{ margin: 0 }}>Verzendbevestiging naar bol: <Status value={ob.status} /> {ob.last_error ? `· ${ob.last_error}` : ""}</p>
          ))}
        </section>

        <section className="card" aria-labelledby="mails">
          <h2 id="mails" style={{ fontSize: "1.125rem" }}>E-mails</h2>
          {o.emails.length === 0 ? <p className="muted">Nog geen e-mails.</p> : (
            <ul style={{ paddingLeft: 18 }}>
              {o.emails.map((e) => (
                <li key={e.kind}>
                  {e.kind === "shipped" ? "Verzendbericht" : "Bestelbevestiging"}: <Status value={e.status} /> <span className="small muted">{dateTime(e.updated_at)} · {e.attempts}×</span>
                  {e.error ? <div className="small stock-none">{e.error}</div> : null}
                  {e.status === "failed" || ((e.status === "pending" || e.status === "sending") && Date.parse(e.updated_at) < Date.parse(o.now) - 30 * 60 * 1000) ? (
                    <form action={resendEmailAction} className="inline-form">
                      <input type="hidden" name="order_id" value={o.id} />
                      <input type="hidden" name="kind" value={e.kind} />
                      <button className="btn btn-sm btn-secondary">Opnieuw versturen</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {o.channel === "web" && o.payment_status !== "pending" ? (
        <details className="panel">
          <summary>Refund</summary>
          {o.refunds.length ? (
            <ul>{o.refunds.map((r, i) => (<li key={i}>{money(r.amount_cents)} · <Status value={r.status} /> · {r.reason ?? ""} · {r.created_by} · {dateTime(r.created_at)} {r.error ? `· ${r.error}` : ""}</li>))}</ul>
          ) : null}
          {refundable ? (
            <form action={refundAction} className="row">
              <input type="hidden" name="order_id" value={o.id} />
              <input type="hidden" name="key" value={randomUUID()} />
              <div><label htmlFor="amount">Bedrag (max {money(o.total_cents - o.refunded_cents)})</label><input id="amount" name="amount" type="text" inputMode="decimal" placeholder="19,95" required /></div>
              <div><label htmlFor="reason">Reden</label><input id="reason" name="reason" type="text" /></div>
              <button className="btn" style={{ flex: "0 0 auto" }}>Terugbetalen</button>
            </form>
          ) : <p className="muted">Geen terug te betalen bedrag.</p>}
          <p className="small muted">Een refund verandert de voorraad niet. Gebruik een retour om artikelen terug te boeken.</p>
        </details>
      ) : null}

      {shipped || o.returns.length ? (
        <details className="panel" open={o.returns.some((r) => r.status === "open")}>
          <summary>Retouren</summary>
          {o.returns.map((r) => (
            <div key={r.id} style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px" }}>Retour van {dateTime(r.created_at)} · <Status value={r.status === "open" ? "pending" : "done"} label={r.status === "open" ? "Open" : "Afgerond"} /> {r.note ? `· ${r.note}` : ""}</p>
              <ul style={{ paddingLeft: 18 }}>
                {r.lines.map((rl) => (
                  <li key={rl.id}>
                    {rl.qty} × {rl.title} ·{" "}
                    {rl.decision === "pending" ? (
                      <span className="inline-form">
                        <form action={decideReturnAction} className="inline-form">
                          <input type="hidden" name="order_id" value={o.id} />
                          <input type="hidden" name="return_line_id" value={rl.id} />
                          <input type="hidden" name="decision" value="restock" />
                          <button className="btn btn-sm">Weer verkoopbaar</button>
                        </form>
                        <form action={decideReturnAction} className="inline-form">
                          <input type="hidden" name="order_id" value={o.id} />
                          <input type="hidden" name="return_line_id" value={rl.id} />
                          <input type="hidden" name="decision" value="writeoff" />
                          <button className="btn btn-sm btn-secondary">Niet verkoopbaar</button>
                        </form>
                      </span>
                    ) : (
                      <span>{rl.decision === "restock" ? "Teruggeboekt" : "Afgeboekt"} door {rl.decided_by}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {returnable.length ? (
            <form action={createReturnAction}>
              <input type="hidden" name="order_id" value={o.id} />
              <h3 style={{ fontSize: "1rem" }}>Nieuwe retour registreren</h3>
              {returnable.map((l) => (
                <div key={l.id} className="row" style={{ alignItems: "center" }}>
                  <label htmlFor={`ret_${l.id}`} style={{ fontWeight: 500 }}>{l.title} (max {l.qty - l.returned_qty})</label>
                  <input id={`ret_${l.id}`} name={`ret_${l.id}`} type="number" min={0} max={l.qty - l.returned_qty} defaultValue={0} style={{ maxWidth: 100 }} />
                </div>
              ))}
              <div className="field"><label htmlFor="note">Notitie</label><input id="note" name="note" type="text" /></div>
              <button className="btn btn-sm">Retour registreren</button>
            </form>
          ) : null}
        </details>
      ) : null}

      {o.fulfillment_status !== "cancelled" && !shipped && o.payment_status !== "expired" ? (
        <details className="panel">
          <summary>Order annuleren</summary>
          <form action={cancelOrderAction}>
            <input type="hidden" name="order_id" value={o.id} />
            <p>Annuleren geeft gereserveerde of afgeboekte voorraad terug (de artikelen zijn nog niet verzonden).</p>
            {refundable ? (
              <label className="check"><input type="checkbox" name="refund" defaultChecked /> Volledig terugbetalen via Stripe</label>
            ) : null}
            {o.channel === "bol" ? <p className="small muted">Annuleer de order ook in het bol-verkopersaccount.</p> : null}
            <button className="btn btn-danger btn-sm">Order annuleren</button>
          </form>
        </details>
      ) : null}

      <details className="panel">
        <summary>Reserveringen en logboek</summary>
        <h3 style={{ fontSize: "1rem" }}>Reserveringen</h3>
        <ul>{o.reservations.map((r, i) => (<li key={i}>{r.code}: {r.qty} stuks · {r.status}</li>))}</ul>
        <h3 style={{ fontSize: "1rem" }}>Logboek</h3>
        <ul className="small">{o.audit.map((a) => (<li key={a.id}>{dateTime(a.at)} · {a.actor} · {a.action}</li>))}</ul>
      </details>
    </>
  );
}
