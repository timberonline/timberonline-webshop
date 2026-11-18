import Link from "next/link";
import { connection } from "next/server";
import { Flash, Status } from "../_components/ui";
import { dateTime, money } from "@/lib/format";
import { getDb } from "@/server/db";
import { integrationStatus } from "@/server/services/runtime";
import { enqueueAllAction, reconcileAction, retryAction, simulateOrderAction, syncNowAction } from "./actions";

type Sync = { status: string; desired_value: number | null; pushed_value: number | null; attempts: number; last_error: string | null; remote_value: number | null; remote_checked_at: string | null; updated_at: string };
type Row = { product_id: string; sku: string; title: string; bol_offer_id: string | null; bol_reference: string | null; ean: string | null; bol_enabled: boolean; bol_title_fix_required: boolean; status: string; bol_price_cents: number | null; target_stock: number; available_units: number; stock: Sync | null; price: Sync | null };
type Data = { sync: Row[]; outbox: { id: string; kind: string; status: string; attempts: number; last_error: string | null; payload: { order_id: string }; created_at: string }[]; sim_offers: { offer_key: string; stock: number | null; price_cents: number | null; update_count: number; updated_at: string }[]; buffer_units: number };

export default async function BolPage({ searchParams }: PageProps<"/beheer/bol">) {
  await connection();
  const sp = await searchParams;
  const d = await getDb().rpc<Data>("api_admin_bol", {});
  const mode = integrationStatus().bol;
  const enabled = d.sync.filter((r) => r.bol_enabled);
  const diffs = enabled.filter((r) => r.stock?.remote_value != null && r.stock.remote_value !== r.target_stock);
  return (
    <>
      <div className="page-head">
        <h1>bol-koppeling</h1>
        <div className="inline-form">
          <form action={syncNowAction}><button className="btn btn-sm">Nu synchroniseren</button></form>
          <form action={enqueueAllAction}><button className="btn btn-sm btn-secondary">Alles herberekenen</button></form>
          <form action={reconcileAction}><button className="btn btn-sm btn-secondary">Vergelijk met bol</button></form>
        </div>
      </div>
      <Flash sp={sp} />
      <p className={`notice ${mode === "gesimuleerd" ? "notice-info" : "notice-warn"}`}>
        Modus: <strong>{mode}</strong>. {mode === "gesimuleerd" ? "Updates gaan naar een gesimuleerde bol-omgeving; er worden geen echte aanbiedingen gewijzigd." : "Live: updates gaan naar bol."} Buffer: {d.buffer_units} verkoopbare eenheid per SKU voor de webshop.
        Volgens de eigenaar is er momenteel geen actief aanbod op bol; controleer bij livegang de gekoppelde aanbiedingen (offerId) en beginstanden.
      </p>
      {diffs.length ? <p className="notice notice-warn">{diffs.length} verschil(len) tussen bol en de gewenste stand gevonden; deze staan opnieuw in de wachtrij.</p> : null}

      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table className="data">
          <thead><tr><th>Artikel</th><th>Referenties</th><th className="r">Vrij (eenh.)</th><th className="r">Naar bol</th><th>Voorraadsync</th><th>Prijssync</th></tr></thead>
          <tbody>
            {d.sync.map((r) => (
              <tr key={r.product_id}>
                <td>
                  <Link href={`/beheer/artikelen/${r.product_id}`}>{r.title}</Link>
                  <div className="small muted">{r.sku} · {r.bol_enabled ? "actief op bol" : "niet actief op bol"}{r.bol_title_fix_required ? " · titel corrigeren" : ""}</div>
                </td>
                <td className="small">{r.bol_reference ?? "–"}<br />EAN {r.ean ?? "–"}<br />offerId {r.bol_offer_id ?? <span className="stock-none">ontbreekt</span>}</td>
                <td className="r num">{r.available_units}</td>
                <td className="r num">{r.bol_enabled ? r.target_stock : "–"}</td>
                <td>
                  {r.stock ? (
                    <>
                      <Status value={r.stock.status} /> <span className="small">verstuurd: {r.stock.pushed_value ?? "–"}{r.stock.remote_value != null ? ` · bol: ${r.stock.remote_value}` : ""}</span>
                      {r.stock.last_error ? <div className="small stock-none">{r.stock.last_error} ({r.stock.attempts}×)</div> : null}
                      {r.stock.status === "failed" || r.stock.status === "pending" ? (
                        <form action={retryAction}><input type="hidden" name="product_id" value={r.product_id} /><input type="hidden" name="kind" value="stock" /><button className="btn btn-sm btn-secondary">Opnieuw</button></form>
                      ) : null}
                    </>
                  ) : "–"}
                </td>
                <td>
                  {r.price ? (
                    <>
                      <Status value={r.price.status} /> <span className="small">{r.price.pushed_value != null ? money(r.price.pushed_value) : "–"}</span>
                      {r.price.last_error ? <div className="small stock-none">{r.price.last_error}</div> : null}
                      {r.price.status === "failed" ? (
                        <form action={retryAction}><input type="hidden" name="product_id" value={r.product_id} /><input type="hidden" name="kind" value="price" /><button className="btn btn-sm btn-secondary">Opnieuw</button></form>
                      ) : null}
                    </>
                  ) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: "1.25rem" }}>Verzendbevestigingen naar bol</h2>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table className="data">
          <thead><tr><th>Aangemaakt</th><th>Order</th><th>Status</th><th>Pogingen</th><th>Fout</th><th /></tr></thead>
          <tbody>
            {d.outbox.length === 0 ? <tr><td colSpan={6} className="muted">Nog geen verzendbevestigingen.</td></tr> : d.outbox.map((o) => (
              <tr key={o.id}>
                <td>{dateTime(o.created_at)}</td>
                <td><Link href={`/beheer/orders/${o.payload.order_id}`}>Order</Link></td>
                <td><Status value={o.status} /></td>
                <td className="num">{o.attempts}</td>
                <td className="small">{o.last_error ?? "–"}</td>
                <td>{o.status === "failed" ? <form action={retryAction}><input type="hidden" name="outbox_id" value={o.id} /><button className="btn btn-sm btn-secondary">Opnieuw</button></form> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mode === "gesimuleerd" ? (
        <>
          <h2 style={{ fontSize: "1.25rem" }}>Testmodus</h2>
          <section className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: "1rem" }}>Simuleer een bol-order</h3>
            <form action={simulateOrderAction} className="row">
              <div>
                <label htmlFor="sim-p">Artikel (actief op bol)</label>
                <select id="sim-p" name="product_id" required>
                  {enabled.length === 0 ? <option value="">Activeer eerst een artikel voor bol</option> : enabled.map((r) => <option key={r.product_id} value={r.product_id}>{r.title}</option>)}
                </select>
              </div>
              <div style={{ flex: "0 1 100px" }}><label htmlFor="sim-q">Aantal</label><input id="sim-q" name="qty" type="number" min={1} max={5} defaultValue={1} /></div>
              <button className="btn" style={{ flex: "0 0 auto" }} disabled={enabled.length === 0}>Order simuleren</button>
            </form>
          </section>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Gesimuleerd aanbod</th><th className="r">Voorraad</th><th className="r">Prijs</th><th className="r">Updates</th><th>Laatst</th></tr></thead>
              <tbody>
                {d.sim_offers.length === 0 ? <tr><td colSpan={5} className="muted">Nog geen gesimuleerde updates.</td></tr> : d.sim_offers.map((s) => (
                  <tr key={s.offer_key}><td>{s.offer_key}</td><td className="r num">{s.stock ?? "–"}</td><td className="r num">{s.price_cents != null ? money(s.price_cents) : "–"}</td><td className="r num">{s.update_count}</td><td>{dateTime(s.updated_at)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
