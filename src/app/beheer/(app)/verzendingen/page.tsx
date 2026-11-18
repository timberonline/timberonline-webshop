import Link from "next/link";
import { connection } from "next/server";
import { Flash, Status } from "../_components/ui";
import { CARRIER_LABEL, dateTime } from "@/lib/format";
import { getDb } from "@/server/db";
import { integrationStatus } from "@/server/services/runtime";
import { cancelShipmentAction, handoverAction, prepareAction, relabelAction, simulateAction, trackingAction, uploadLabelAction } from "./actions";

type Open = {
  order_id: string; number: string; channel: string; customer_name: string | null; city: string | null; postal_code: string | null;
  created_at: string; ship_deadline: string | null; deadline_soon: boolean; tracking_promised: boolean; shipping_option: string; allowed_carriers: string[]; address_problems: string[];
  shipment_id: string | null; carrier: string | null; shipment_status: string | null; label_status: string | null; label_source: string | null;
  tracking_code: string | null; tracking_url: string | null; ship_date: string | null; exception_reason: string | null; label_error: string | null;
  weight_g: number | null; package_format: string | null; has_label: boolean; lines: { sku: string; title: string; qty: number }[];
};
type View = {
  date: string;
  open: Open[];
  day: { shipment_id: string; order_id: string; number: string; channel: string; carrier: string; status: string; label_status: string; tracking_code: string | null; handed_over_at: string | null; handover_manual: boolean; has_label: boolean }[];
  recent: { shipment_id: string; order_id: string; number: string; carrier: string; status: string; tracking_code: string | null; handed_over_at: string; delivered_at: string | null; channel: string }[];
  sender_address: { name?: string; street?: string | null; house_number?: string | null; postal_code?: string | null; city?: string | null } | null;
};

export default async function ShipmentsPage({ searchParams }: PageProps<"/beheer/verzendingen">) {
  await connection();
  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  const v = await getDb().rpc<View>("api_admin_shipments", date ? { date } : {});
  const simulated = integrationStatus().carriers.startsWith("gesimuleerd");
  const s = v.sender_address;
  const senderMissing = !s || !s.street || !s.house_number || !s.postal_code || !s.city;
  const exceptions = v.open.filter((o) => o.address_problems.length || o.shipment_status === "exception" || (o.deadline_soon && !["handed_over", "in_transit", "delivered", "ready_for_pickup"].includes(o.shipment_status ?? "")));

  return (
    <>
      <div className="page-head">
        <h1>Verzendingen</h1>
        <form method="get" className="inline-form" aria-label="Verzenddag kiezen">
          <label htmlFor="date" className="sr-only">Verzenddag</label>
          <input id="date" name="date" type="date" defaultValue={v.date} style={{ width: "auto" }} />
          <button className="btn btn-secondary btn-sm">Toon dag</button>
          <a className="btn btn-sm" href={`/beheer/dagpdf/${v.date}`}>Dag-PDF ({v.day.filter((d) => d.has_label).length} labels)</a>
        </form>
      </div>
      <Flash sp={sp} />
      {simulated ? <p className="notice notice-info">Testmodus: DHL en PostNL maken voorbeeldlabels met gesimuleerde tracking. Briefpost maakt een adreslabel voor handmatig frankeren.</p> : null}
      {senderMissing ? <p className="notice notice-warn">Afzenderadres ontbreekt op labels. <Link href="/beheer/instellingen">Stel het in bij Instellingen</Link>.</p> : null}

      {exceptions.length ? (
        <section className="card" aria-labelledby="uitz" style={{ marginBottom: 16, borderLeft: "4px solid var(--to-danger)" }}>
          <h2 id="uitz" style={{ fontSize: "1.125rem" }}>Uitzonderingen</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {exceptions.map((o) => (
              <li key={o.order_id}>
                <Link href={`/beheer/orders/${o.order_id}`}>{o.number}</Link>:{" "}
                {[
                  ...o.address_problems.map((p) => `adres: ${p}`),
                  o.shipment_status === "exception" ? o.exception_reason ?? "uitzondering" : null,
                  !o.has_label ? "label ontbreekt" : null,
                  o.ship_deadline ? `uiterlijk ${dateTime(o.ship_deadline)}` : null,
                ].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 style={{ fontSize: "1.25rem" }}>Te verzenden ({v.open.length})</h2>
      {v.open.length === 0 ? <p className="card muted">Niets te verzenden.</p> : null}
      <div className="stack" style={{ marginBottom: 24 }}>
        {v.open.map((o) => (
          <article key={o.order_id} className="card" aria-labelledby={`o-${o.order_id}`}>
            <div className="page-head" style={{ marginBottom: 8 }}>
              <h3 id={`o-${o.order_id}`} style={{ margin: 0, fontSize: "1.0625rem" }}>
                <Link href={`/beheer/orders/${o.order_id}`}>{o.number}</Link> <span className="badge">{o.channel === "bol" ? "bol" : "web"}</span>{" "}
                {o.shipment_status ? <Status value={o.shipment_status} /> : <Status value="unfulfilled" />}
              </h3>
              <span className="small muted">{o.customer_name} · {o.postal_code} {o.city}{o.ship_deadline ? ` · uiterlijk ${dateTime(o.ship_deadline)}` : ""}</span>
            </div>
            <p className="small" style={{ margin: "0 0 8px" }}>
              {o.lines.map((l) => `${l.qty}× ${l.sku}`).join(", ")}
              {o.weight_g ? ` · ${o.weight_g} g · ${o.package_format}` : ""} · {o.tracking_promised ? "track & trace beloofd" : "briefpost gekozen"}
            </p>

            {!o.shipment_id || o.label_status !== "ready" ? (
              <form action={prepareAction} className="inline-form" style={{ marginBottom: 8 }}>
                <input type="hidden" name="order_id" value={o.order_id} />
                <input type="hidden" name="date" value={v.date} />
                <label htmlFor={`c-${o.order_id}`} className="sr-only">Vervoerder</label>
                <select id={`c-${o.order_id}`} name="carrier" defaultValue={o.carrier ?? ""} style={{ width: "auto", minHeight: 36, padding: "6px 8px" }}>
                  <option value="">Voorkeur ({o.allowed_carriers.includes("dhl") ? "DHL" : CARRIER_LABEL[o.allowed_carriers[0]]})</option>
                  {["dhl", "postnl", "letter"].map((c) => (
                    <option key={c} value={c} disabled={!o.allowed_carriers.includes(c)}>{CARRIER_LABEL[c]}{!o.allowed_carriers.includes(c) ? " (niet toegestaan)" : ""}</option>
                  ))}
                </select>
                {o.tracking_promised ? (
                  <label className="check small" style={{ minHeight: 36 }}><input type="checkbox" name="override" /> Briefpost toestaan ondanks trackingbelofte</label>
                ) : null}
                <button className="btn btn-sm">{o.shipment_id ? "Label opnieuw maken" : "Label maken"}</button>
              </form>
            ) : null}

            {o.shipment_id ? (
              <div className="stack">
                <p className="small" style={{ margin: 0 }}>
                  {CARRIER_LABEL[o.carrier ?? ""]} · label: <Status value={o.label_status === "ready" ? "label_ready" : o.label_status === "failed" ? "failed" : "draft"} label={o.label_status === "ready" ? `klaar (${o.label_source})` : o.label_status ?? ""} />
                  {o.tracking_code ? ` · ${o.tracking_code}` : ""}
                  {o.exception_reason ? <span className="stock-none"> · {o.exception_reason}</span> : null}
                </p>
                <div className="inline-form">
                  {o.has_label ? <a className="btn btn-sm btn-secondary" href={`/beheer/label/${o.shipment_id}`}>Label (PDF)</a> : null}
                  {o.label_status === "failed" ? (
                    <form action={relabelAction}><input type="hidden" name="shipment_id" value={o.shipment_id} /><input type="hidden" name="date" value={v.date} /><button className="btn btn-sm">Opnieuw proberen</button></form>
                  ) : null}
                  {o.label_status === "ready" ? (
                    <form action={handoverAction}>
                      <input type="hidden" name="shipment_id" value={o.shipment_id} /><input type="hidden" name="date" value={v.date} />
                      <button className="btn btn-sm btn-dark">{o.carrier === "letter" ? "Gepost — bevestigen" : "Overdracht bevestigen"}</button>
                    </form>
                  ) : null}
                  {simulated && o.label_status === "ready" && o.carrier !== "letter" ? (
                    <form action={simulateAction} className="inline-form">
                      <input type="hidden" name="shipment_id" value={o.shipment_id} /><input type="hidden" name="date" value={v.date} />
                      <input type="hidden" name="status" value="in_transit" />
                      <button className="btn btn-sm btn-secondary">Simuleer scan</button>
                    </form>
                  ) : null}
                  <form action={cancelShipmentAction}><input type="hidden" name="shipment_id" value={o.shipment_id} /><input type="hidden" name="date" value={v.date} /><button className="btn btn-sm btn-secondary">Zending annuleren</button></form>
                </div>
                <details>
                  <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Elders gekocht label of handmatige trackingcode</summary>
                  <form action={uploadLabelAction} className="row" encType="multipart/form-data">
                    <input type="hidden" name="shipment_id" value={o.shipment_id} /><input type="hidden" name="date" value={v.date} />
                    <div><label htmlFor={`f-${o.shipment_id}`}>Label (PDF/PNG/JPG)</label><input id={`f-${o.shipment_id}`} name="file" type="file" accept="application/pdf,image/png,image/jpeg" required /></div>
                    <div><label htmlFor={`tc-${o.shipment_id}`}>Trackingcode</label><input id={`tc-${o.shipment_id}`} name="tracking_code" type="text" /></div>
                    <div><label htmlFor={`tu-${o.shipment_id}`}>Tracking-URL</label><input id={`tu-${o.shipment_id}`} name="tracking_url" type="text" /></div>
                    <button className="btn btn-sm" style={{ flex: "0 0 auto" }}>Uploaden</button>
                  </form>
                  <form action={trackingAction} className="row" style={{ marginTop: 8 }}>
                    <input type="hidden" name="shipment_id" value={o.shipment_id} /><input type="hidden" name="date" value={v.date} />
                    <div><label htmlFor={`mt-${o.shipment_id}`}>Alleen trackingcode</label><input id={`mt-${o.shipment_id}`} name="tracking_code" type="text" required /></div>
                    <div><label htmlFor={`mu-${o.shipment_id}`}>Tracking-URL</label><input id={`mu-${o.shipment_id}`} name="tracking_url" type="text" /></div>
                    <button className="btn btn-sm btn-secondary" style={{ flex: "0 0 auto" }}>Opslaan</button>
                  </form>
                </details>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <h2 style={{ fontSize: "1.25rem" }}>Verzenddag {v.date}</h2>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table className="data">
          <thead><tr><th>Order</th><th>Vervoerder</th><th>Status</th><th>Tracking</th><th>Overdracht</th><th>Label</th></tr></thead>
          <tbody>
            {v.day.length === 0 ? <tr><td colSpan={6} className="muted">Geen zendingen op deze dag.</td></tr> : v.day.map((d) => (
              <tr key={d.shipment_id}>
                <td><Link href={`/beheer/orders/${d.order_id}`}>{d.number}</Link> <span className="badge">{d.channel}</span></td>
                <td>{CARRIER_LABEL[d.carrier]}</td>
                <td><Status value={d.status} /></td>
                <td>{d.tracking_code ?? "–"}</td>
                <td>{d.handed_over_at ? `${dateTime(d.handed_over_at)}${d.handover_manual ? " (handmatig)" : ""}` : "–"}</td>
                <td>{d.has_label ? <a href={`/beheer/label/${d.shipment_id}`}>PDF</a> : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: "1.25rem" }}>Recent verzonden</h2>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Order</th><th>Vervoerder</th><th>Status</th><th>Tracking</th><th>Overgedragen</th><th>Simulatie</th></tr></thead>
          <tbody>
            {v.recent.length === 0 ? <tr><td colSpan={6} className="muted">Nog niets verzonden.</td></tr> : v.recent.map((r) => (
              <tr key={r.shipment_id}>
                <td><Link href={`/beheer/orders/${r.order_id}`}>{r.number}</Link></td>
                <td>{CARRIER_LABEL[r.carrier]}</td>
                <td><Status value={r.status} /></td>
                <td>{r.tracking_code ?? "–"}</td>
                <td>{dateTime(r.handed_over_at)}</td>
                <td>
                  {simulated && r.carrier !== "letter" && r.status !== "delivered" ? (
                    <span className="inline-form">
                      {["ready_for_pickup", "delivered"].map((st) => (
                        <form key={st} action={simulateAction}>
                          <input type="hidden" name="shipment_id" value={r.shipment_id} /><input type="hidden" name="date" value={v.date} />
                          <input type="hidden" name="status" value={st} />
                          <button className="btn btn-sm btn-secondary">{st === "delivered" ? "Bezorgd" : "Klaar om af te halen"}</button>
                        </form>
                      ))}
                    </span>
                  ) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
