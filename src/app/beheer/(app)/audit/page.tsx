import { connection } from "next/server";
import { dateTime } from "@/lib/format";
import { getDb } from "@/server/db";

type Row = { id: number; at: string; actor: string; action: string; entity: string; entity_id: string | null; before: unknown; after: unknown };

export default async function AuditPage({ searchParams }: PageProps<"/beheer/audit">) {
  await connection();
  const sp = await searchParams;
  const entity = typeof sp.entity === "string" && sp.entity ? sp.entity : undefined;
  const rows = await getDb().rpc<Row[]>("api_admin_audit", { entity, limit: 300 });
  return (
    <>
      <div className="page-head">
        <h1>Logboek</h1>
        <form method="get" className="inline-form">
          <label htmlFor="entity" className="sr-only">Soort</label>
          <select id="entity" name="entity" defaultValue={entity ?? ""} style={{ width: "auto" }}>
            <option value="">Alles</option>
            <option value="product">Prijzen en artikelen</option>
            <option value="component">Voorraad</option>
            <option value="order">Orders</option>
            <option value="shipment">Zendingen</option>
            <option value="discount_rule">Acties</option>
            <option value="setting">Instellingen</option>
          </select>
          <button className="btn btn-sm btn-secondary">Filter</button>
        </form>
      </div>
      <p className="muted">Kritieke voorraad-, prijs- en orderwijzigingen met tijdstip en uitvoerder.</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Tijdstip</th><th>Uitvoerder</th><th>Actie</th><th>Onderwerp</th><th>Wijziging</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{dateTime(r.at)}</td>
                <td className="small">{r.actor}</td>
                <td>{r.action}</td>
                <td className="small">{r.entity}</td>
                <td className="small" style={{ maxWidth: 420 }}>
                  {r.before || r.after ? (
                    <details>
                      <summary style={{ cursor: "pointer" }}>Details</summary>
                      <pre className="code">{JSON.stringify({ voor: r.before, na: r.after }, null, 1)}</pre>
                    </details>
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
