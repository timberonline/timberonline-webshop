import { connection } from "next/server";
import { Flash } from "../_components/ui";
import { dateTime } from "@/lib/format";
import { getDb } from "@/server/db";
import { correctStockAction } from "./actions";

type Data = {
  components: { id: string; code: string; name: string; kind: string; on_hand: number; reserved: number; free: number; low_stock_threshold: number; products: { sku: string; qty: number; status: string }[] }[];
  movements: { id: number; code: string; delta: number; on_hand_after: number; reason: string; actor: string; note: string | null; order_number: string | null; created_at: string }[];
};

const REASON: Record<string, string> = { opening: "Openingstelling", sale_web: "Verkoop webshop", sale_bol: "Verkoop bol", correction: "Correctie", return_restock: "Retour terug", cancel_restock: "Annulering terug" };

export default async function StockPage({ searchParams }: PageProps<"/beheer/voorraad">) {
  await connection();
  const sp = await searchParams;
  const d = await getDb().rpc<Data>("api_admin_components", { limit: 100 });
  const total = (k: string) => d.components.filter((c) => c.kind === k).reduce((s, c) => s + c.on_hand, 0);
  return (
    <>
      <div className="page-head">
        <h1>Voorraad</h1>
        <p className="muted" style={{ margin: 0 }}>Fysiek: {total("protector")} protectors · {total("case")} hoesjes (per stuk)</p>
      </div>
      <Flash sp={sp} />
      <p className="muted">Supabase is leidend voor de gedeelde fysieke voorraad. Sets en bundels gebruiken dezelfde onderdelen; vrij = fysiek − open reserveringen.</p>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table className="data">
          <thead><tr><th>Onderdeel</th><th className="r">Fysiek</th><th className="r">Gereserveerd</th><th className="r">Vrij</th><th>Gebruikt in</th><th>Correctie</th></tr></thead>
          <tbody>
            {d.components.map((c) => (
              <tr key={c.id}>
                <td>{c.name}<div className="small muted">{c.code}</div></td>
                <td className="r num">{c.on_hand}</td>
                <td className="r num">{c.reserved}</td>
                <td className={`r num ${c.free <= 0 ? "stock-none" : c.free <= c.low_stock_threshold ? "stock-low" : ""}`}>{c.free}</td>
                <td className="small">{c.products.map((p) => `${p.sku} (${p.qty}×)`).join(", ")}</td>
                <td>
                  <form action={correctStockAction} className="inline-form">
                    <input type="hidden" name="component_id" value={c.id} />
                    <label className="sr-only" htmlFor={`m-${c.id}`}>Soort correctie</label>
                    <select id={`m-${c.id}`} name="mode" defaultValue="delta" style={{ width: "auto", minHeight: 36, padding: "6px 8px" }}>
                      <option value="delta">+/−</option>
                      <option value="set">Telling</option>
                    </select>
                    <label className="sr-only" htmlFor={`v-${c.id}`}>Aantal</label>
                    <input id={`v-${c.id}`} name="value" type="number" required style={{ width: 80 }} />
                    <label className="sr-only" htmlFor={`r-${c.id}`}>Reden</label>
                    <input id={`r-${c.id}`} name="reason" type="text" required placeholder="Reden" />
                    <button className="btn btn-sm btn-secondary">Boeken</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 style={{ fontSize: "1.25rem" }}>Laatste mutaties</h2>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Tijdstip</th><th>Onderdeel</th><th className="r">Mutatie</th><th className="r">Na</th><th>Reden</th><th>Door</th></tr></thead>
          <tbody>
            {d.movements.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">{dateTime(m.created_at)}</td>
                <td>{m.code}</td>
                <td className="r num">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                <td className="r num">{m.on_hand_after}</td>
                <td>{REASON[m.reason] ?? m.reason}{m.order_number ? ` · ${m.order_number}` : ""}{m.note ? ` · ${m.note}` : ""}</td>
                <td className="small">{m.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
