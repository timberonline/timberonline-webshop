import { connection } from "next/server";
import { Flash, Status } from "../_components/ui";
import { dateTime, money } from "@/lib/format";
import { getDb } from "@/server/db";
import { integrationStatus } from "@/server/services/runtime";
import { applyAction, cancelProposalAction, proposeAction } from "./actions";

type Item = { product_id: string; sku: string; title: string; channel: "web" | "bol"; old_cents: number | null; new_cents: number; bol_enabled?: boolean; applied?: boolean; error?: string };
type Proposal = { id: string; created_by: string; prompt: string; provider: string; items: Item[]; status: string; result: Item[] | null; created_at: string; decided_by: string | null; bol_status: Record<string, { status: string; last_error: string | null; pushed_value: number | null; desired_value: number | null }> };

export default async function AssistantPage({ searchParams }: PageProps<"/beheer/prijsassistent">) {
  await connection();
  const sp = await searchParams;
  const current = typeof sp.voorstel === "string" ? sp.voorstel : null;
  const uitleg = typeof sp.uitleg === "string" ? sp.uitleg : null;
  const list = await getDb().rpc<Proposal[]>("api_admin_ai_proposals", {});
  const p = current ? list.find((x) => x.id === current) ?? null : null;

  return (
    <>
      <div className="page-head"><h1>Prijsassistent</h1></div>
      <Flash sp={sp} />
      <p className="notice notice-info">Provider: {integrationStatus().ai}. De assistent stelt alleen voor; pas na jouw bevestiging worden prijzen gewijzigd via dezelfde controle als handmatig prijsbeheer. Voorraad blijft ongemoeid.</p>
      <form action={proposeAction} className="card" style={{ marginBottom: 16 }}>
        <label htmlFor="prompt">Opdracht</label>
        <textarea id="prompt" name="prompt" required maxLength={500} placeholder="Zet de webshopprijs van alle iPhone 15-privacysets op €14,95" />
        <p className="field-hint">Noem kanaal (webshop, bol of beide), artikelen (toestel, type of SKU) en de nieuwe prijs of wijziging (bijv. ‘verlaag met 10%’).</p>
        <button className="btn" style={{ marginTop: 8 }}>Voorstel maken</button>
      </form>

      {p ? (
        <section className="card" aria-labelledby="voorstel" style={{ marginBottom: 16 }}>
          <h2 id="voorstel" style={{ fontSize: "1.25rem" }}>Voorstel</h2>
          <p className="muted">“{p.prompt}” · {p.provider} · {dateTime(p.created_at)} · <Status value={p.status === "proposed" ? "pending" : p.status === "applied" ? "done" : "cancelled"} label={p.status === "proposed" ? "Wacht op bevestiging" : p.status === "applied" ? "Toegepast" : "Geannuleerd"} /></p>
          {uitleg ? <p className="notice notice-warn">{uitleg}</p> : null}
          {p.status === "proposed" ? (
            <>
              <form action={applyAction}>
                <input type="hidden" name="id" value={p.id} />
                <div className="table-wrap" style={{ boxShadow: "none", border: "1px solid var(--to-border)" }}>
                  <table className="data">
                    <thead><tr><th>Toepassen</th><th>SKU</th><th>Artikel</th><th>Kanaal</th><th className="r">Huidig</th><th className="r">Nieuw</th></tr></thead>
                    <tbody>
                      {p.items.map((it) => {
                        const key = `${it.product_id}:${it.channel}`;
                        return (
                          <tr key={key}>
                            <td><label className="sr-only" htmlFor={key}>Toepassen op {it.sku} {it.channel}</label><input id={key} type="checkbox" name="sel" value={key} defaultChecked /></td>
                            <td>{it.sku}</td>
                            <td>{it.title}</td>
                            <td>{it.channel === "web" ? "Webshop" : `bol${it.bol_enabled ? "" : " (niet actief)"}`}</td>
                            <td className="r num">{money(it.old_cents)}</td>
                            <td className="r num"><strong>{money(it.new_cents)}</strong></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button className="btn" style={{ marginTop: 12 }}>Geselecteerde wijzigingen bevestigen</button>
              </form>
              <form action={cancelProposalAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={p.id} />
                <button className="btn btn-secondary btn-sm">Annuleren</button>
              </form>
            </>
          ) : p.result ? (
            <div className="table-wrap" style={{ boxShadow: "none", border: "1px solid var(--to-border)" }}>
              <table className="data">
                <thead><tr><th>SKU</th><th>Kanaal</th><th className="r">Oud</th><th className="r">Nieuw</th><th>Resultaat</th><th>bol</th></tr></thead>
                <tbody>
                  {p.result.map((it) => {
                    const bol = it.channel === "bol" ? p.bol_status[it.product_id] : null;
                    return (
                      <tr key={`${it.product_id}:${it.channel}`}>
                        <td>{it.sku}</td>
                        <td>{it.channel === "web" ? "Webshop" : "bol"}</td>
                        <td className="r num">{money(it.old_cents)}</td>
                        <td className="r num">{money(it.new_cents)}</td>
                        <td>{it.applied ? <Status value="done" label="Toegepast" /> : <Status value="failed" label={it.error ?? "Niet toegepast"} />}</td>
                        <td>{it.channel !== "bol" ? "–" : !it.bol_enabled ? <span className="small muted">kanaal niet actief</span> : bol ? <><Status value={bol.status} />{bol.last_error ? <div className="small stock-none">{bol.last_error}</div> : null}</> : <Status value="pending" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <h2 style={{ fontSize: "1.25rem" }}>Eerdere voorstellen</h2>
      <ul className="card" style={{ listStyle: "none", paddingLeft: 20 }}>
        {list.length === 0 ? <li className="muted">Nog geen voorstellen.</li> : list.map((x) => (
          <li key={x.id} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <a href={`/beheer/prijsassistent?voorstel=${x.id}`}>{x.prompt}</a>
            <span className="small muted">{dateTime(x.created_at)} · {x.items.length} wijziging(en) · {x.status}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
