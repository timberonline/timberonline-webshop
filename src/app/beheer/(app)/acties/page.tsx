import { connection } from "next/server";
import { Flash, Status } from "../_components/ui";
import { money } from "@/lib/format";
import { getDb } from "@/server/db";
import { deleteDiscountAction, saveDiscountAction } from "./actions";

type Rule = { id: string; name: string; min_qty: number; discount_type: "fixed" | "percent"; value: number; active: boolean; starts_at: string | null; ends_at: string | null; product_ids: string[] };
type P = { id: string; sku: string; title: string; kind: string; status: string; allow_tier_discount: boolean };

function RuleForm({ rule, products }: { rule: Rule | null; products: P[] }) {
  const k = rule?.id ?? "new";
  return (
    <form action={saveDiscountAction}>
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <div className="row">
        <div className="field"><label htmlFor={`n-${k}`}>Naam (zichtbaar voor klant)</label><input id={`n-${k}`} name="name" type="text" required defaultValue={rule?.name ?? ""} placeholder="Vanaf 2 sets 10% korting" /></div>
        <div className="field" style={{ flex: "0 1 140px" }}><label htmlFor={`q-${k}`}>Vanaf aantal</label><input id={`q-${k}`} name="min_qty" type="number" min={1} required defaultValue={rule?.min_qty ?? 2} /></div>
        <div className="field" style={{ flex: "0 1 160px" }}>
          <label htmlFor={`t-${k}`}>Soort</label>
          <select id={`t-${k}`} name="discount_type" defaultValue={rule?.discount_type ?? "percent"}>
            <option value="percent">Percentage</option>
            <option value="fixed">Vast bedrag per stuk</option>
          </select>
        </div>
        <div className="field" style={{ flex: "0 1 140px" }}><label htmlFor={`v-${k}`}>Waarde (% of €)</label><input id={`v-${k}`} name="value" type="text" required defaultValue={rule ? (rule.discount_type === "fixed" ? (rule.value / 100).toFixed(2).replace(".", ",") : String(rule.value)) : "10"} /></div>
      </div>
      <div className="row">
        <div className="field"><label htmlFor={`s-${k}`}>Start (optioneel)</label><input id={`s-${k}`} name="starts_at" type="date" defaultValue={rule?.starts_at?.slice(0, 10) ?? ""} /></div>
        <div className="field"><label htmlFor={`e-${k}`}>Einde (optioneel)</label><input id={`e-${k}`} name="ends_at" type="date" defaultValue={rule?.ends_at?.slice(0, 10) ?? ""} /></div>
        <label className="check"><input type="checkbox" name="active" defaultChecked={rule?.active ?? true} /> Actief</label>
      </div>
      <fieldset style={{ border: "1px solid var(--to-border)", borderRadius: 10, padding: 12, margin: "0 0 12px" }}>
        <legend style={{ fontWeight: 600, padding: "0 4px" }}>Geldt voor artikelen</legend>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap: 0 }}>
          {products.map((p) => (
            <label key={p.id} className="check small" style={{ minHeight: 36 }}>
              <input type="checkbox" name="product_ids" value={p.id} defaultChecked={rule?.product_ids.includes(p.id) ?? false} />
              {p.title}{p.kind === "bundle" && !p.allow_tier_discount ? " (bundel: geen staffel)" : ""}
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn btn-sm">{rule ? "Opslaan" : "Actie toevoegen"}</button>
    </form>
  );
}

export default async function DiscountsPage({ searchParams }: PageProps<"/beheer/acties">) {
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const [rules, products] = await Promise.all([db.rpc<Rule[]>("api_admin_discounts", {}), db.rpc<P[]>("api_admin_products", {})]);
  const selectable = products.filter((p) => p.status !== "archived");
  return (
    <>
      <div className="page-head"><h1>Acties en staffelkorting</h1></div>
      <Flash sp={sp} />
      <p className="muted">Staffelkorting geldt per stuk zodra het totaal van de geselecteerde artikelen in de winkelwagen het minimum bereikt. Per regel geldt de hoogste korting; kortingen stapelen niet. Bundels krijgen standaard geen staffelkorting.</p>
      {rules.map((r) => (
        <details key={r.id} className="panel">
          <summary>
            {r.name} · {r.discount_type === "percent" ? `${r.value}%` : `${money(r.value)} p/st`} vanaf {r.min_qty} · <Status value={r.active ? "active" : "archived"} label={r.active ? "Actief" : "Uit"} />
          </summary>
          <RuleForm rule={r} products={selectable} />
          <form action={deleteDiscountAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn btn-sm btn-secondary">Verwijderen</button>
          </form>
        </details>
      ))}
      <details className="panel" open={rules.length === 0}>
        <summary>Nieuwe actie</summary>
        <RuleForm rule={null} products={selectable} />
      </details>
    </>
  );
}
