import Link from "next/link";
import { connection } from "next/server";
import { Flash, Status } from "../_components/ui";
import { dateTime, money } from "@/lib/format";
import { getDb } from "@/server/db";

type Row = { id: string; number: string; channel: string; payment_status: string; stock_status: string; fulfillment_status: string; customer_name: string | null; email: string | null; total_cents: number; created_at: string; needs_attention: boolean; attention_reason: string | null; mail_problem: boolean; items: number };

export default async function OrdersPage({ searchParams }: PageProps<"/beheer/orders">) {
  await connection();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const rows = await getDb().rpc<Row[]>("api_admin_orders", {
    q: one("q"),
    channel: one("channel"),
    payment_status: one("payment_status"),
    attention: one("attention") === "1",
    mail_problem: one("mail") === "1",
  });
  return (
    <>
      <div className="page-head">
        <h1>Orders</h1>
      </div>
      <Flash sp={sp} />
      <form className="card row" method="get" style={{ marginBottom: 16 }} aria-label="Orders filteren">
        <div>
          <label htmlFor="q">Zoeken</label>
          <input id="q" name="q" type="search" defaultValue={one("q")} placeholder="Ordernummer, naam, e-mail, bol-id" />
        </div>
        <div>
          <label htmlFor="channel">Kanaal</label>
          <select id="channel" name="channel" defaultValue={one("channel") ?? ""}>
            <option value="">Alle</option>
            <option value="web">Webshop</option>
            <option value="bol">bol</option>
          </select>
        </div>
        <div>
          <label htmlFor="payment_status">Betaling</label>
          <select id="payment_status" name="payment_status" defaultValue={one("payment_status") ?? ""}>
            <option value="">Alle</option>
            <option value="paid">Betaald</option>
            <option value="pending">Wacht op betaling</option>
            <option value="expired">Verlopen</option>
            <option value="cancelled">Geannuleerd</option>
            <option value="refunded">Terugbetaald</option>
            <option value="partially_refunded">Deels terugbetaald</option>
          </select>
        </div>
        <label className="check" style={{ flex: "0 0 auto" }}>
          <input type="checkbox" name="attention" value="1" defaultChecked={one("attention") === "1"} /> Alleen met aandacht
        </label>
        <label className="check" style={{ flex: "0 0 auto" }}>
          <input type="checkbox" name="mail" value="1" defaultChecked={one("mail") === "1"} /> Alleen met mailprobleem
        </label>
        <button className="btn" style={{ flex: "0 0 auto" }}>
          Filter
        </button>
      </form>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Order</th>
              <th>Datum</th>
              <th>Klant</th>
              <th>Betaling</th>
              <th>Voorraad</th>
              <th>Verzending</th>
              <th className="r">Totaal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  Geen orders gevonden.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/beheer/orders/${r.id}`}>{r.number}</Link> <span className="badge">{r.channel === "bol" ? "bol" : "web"}</span>
                    {r.needs_attention ? (
                      <div className="small stock-none" title={r.attention_reason ?? ""}>
                        Aandacht nodig
                      </div>
                    ) : null}
                    {r.mail_problem ? <div className="small stock-none">E-mail niet verstuurd</div> : null}
                  </td>
                  <td className="nowrap">{dateTime(r.created_at)}</td>
                  <td>{r.customer_name ?? r.email ?? "–"}</td>
                  <td>
                    <Status value={r.payment_status} />
                  </td>
                  <td>
                    <Status value={r.stock_status} />
                  </td>
                  <td>
                    <Status value={r.fulfillment_status} />
                  </td>
                  <td className="r num">{money(r.total_cents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
