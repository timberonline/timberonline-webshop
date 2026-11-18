import Link from "next/link";
import { connection } from "next/server";
import { Status } from "./_components/ui";
import { dateTime } from "@/lib/format";
import { getDb } from "@/server/db";
import { integrationStatus } from "@/server/services/runtime";

type Overview = {
  orders_pending: number;
  orders_to_ship: number;
  attention: { id: string; number: string; channel: string; reason: string; created_at: string }[];
  low_stock: { id: string; code: string; name: string; free: number; on_hand: number }[];
  bol_failed: number;
  bol_pending: number;
  shipment_exceptions: number;
  email_failed: number;
  outbox_failed: number;
  stock_totals: { protectors: number; cases: number; reserved: number };
};

export default async function Dashboard() {
  await connection();
  const o = await getDb().rpc<Overview>("api_admin_overview", {});
  const integ = integrationStatus();
  const kpis = [
    { l: "Te verzenden", v: o.orders_to_ship, href: "/beheer/verzendingen" },
    { l: "Wacht op betaling", v: o.orders_pending, href: "/beheer/orders?payment_status=pending" },
    { l: "Protectors op voorraad", v: o.stock_totals.protectors, href: "/beheer/voorraad" },
    { l: "Hoesjes op voorraad", v: o.stock_totals.cases, href: "/beheer/voorraad" },
    { l: "Gereserveerd (stuks)", v: o.stock_totals.reserved, href: "/beheer/voorraad" },
  ];
  const problems = [
    o.bol_failed && { t: `${o.bol_failed} mislukte bol-update(s)`, href: "/beheer/bol" },
    o.shipment_exceptions && { t: `${o.shipment_exceptions} verzenduitzondering(en)`, href: "/beheer/verzendingen" },
    o.email_failed && { t: `${o.email_failed} mislukte of vastgelopen e-mail(s)`, href: "/beheer/orders?mail=1" },
    o.outbox_failed && { t: `${o.outbox_failed} mislukte verzendbevestiging(en) naar bol`, href: "/beheer/bol" },
  ].filter(Boolean) as { t: string; href: string }[];

  return (
    <>
      <div className="page-head">
        <h1>Overzicht</h1>
      </div>
      <div className="kpis">
        {kpis.map((k) => (
          <Link key={k.l} href={k.href} className="kpi" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="v">{k.v}</div>
            <div className="l">{k.l}</div>
          </Link>
        ))}
      </div>

      {problems.length ? (
        <section className="notice notice-danger" aria-labelledby="problemen">
          <h2 id="problemen" style={{ fontSize: "1.125rem" }}>
            Actie nodig
          </h2>
          <ul style={{ margin: 0 }}>
            {problems.map((p) => (
              <li key={p.t}>
                <Link href={p.href}>{p.t}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
        <section className="card" aria-labelledby="aandacht">
          <h2 id="aandacht" style={{ fontSize: "1.125rem" }}>
            Orders met aandacht
          </h2>
          {o.attention.length === 0 ? (
            <p className="muted">Geen.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {o.attention.map((a) => (
                <li key={a.id}>
                  <Link href={`/beheer/orders/${a.id}`}>{a.number}</Link> ({a.channel}) · {dateTime(a.created_at)}
                  <br />
                  <span className="small">{a.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="laag">
          <h2 id="laag" style={{ fontSize: "1.125rem" }}>
            Lage voorraad (vrij)
          </h2>
          {o.low_stock.length === 0 ? (
            <p className="muted">Geen.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Onderdeel</th>
                  <th className="r">Vrij</th>
                </tr>
              </thead>
              <tbody>
                {o.low_stock.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="r num">{c.free}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card" aria-labelledby="koppelingen">
          <h2 id="koppelingen" style={{ fontSize: "1.125rem" }}>
            Koppelingen
          </h2>
          <dl className="dl">
            <dt>Betalingen</dt>
            <dd>
              <Status value={integ.stripe === "testmodus" ? "simulated" : integ.stripe === "LIVE" ? "active" : "failed"} label={`Stripe: ${integ.stripe}`} />
            </dd>
            <dt>E-mail</dt>
            <dd>{integ.mail}</dd>
            <dt>bol</dt>
            <dd>{integ.bol}</dd>
            <dt>Vervoerders</dt>
            <dd>{integ.carriers}</dd>
            <dt>AI-assistent</dt>
            <dd>{integ.ai}</dd>
            <dt>Opslag</dt>
            <dd>
              {integ.data} / {integ.storage}
            </dd>
          </dl>
        </section>
      </div>
    </>
  );
}
