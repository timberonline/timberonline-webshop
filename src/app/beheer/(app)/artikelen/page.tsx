import Link from "next/link";
import { connection } from "next/server";
import { Flash, Status } from "../_components/ui";
import { money, TYPE_LABEL } from "@/lib/format";
import { getDb } from "@/server/db";
import { setPriceAction } from "./actions";

export type AdminProductRow = {
  id: string; sku: string; slug: string; kind: string; product_type: string; title: string; status: string; ean: string | null;
  bol_reference: string | null; bol_offer_id: string | null; bol_enabled: boolean; bol_title_fix_required: boolean; web_enabled: boolean;
  web_price_cents: number; bol_price_cents: number | null; available_units: number; bol_target_stock: number; review_note: string | null;
  devices: { slug: string; name: string; confirmed: boolean }[];
  bol_sync: { stock?: { status: string }; price?: { status: string; last_error: string | null } };
};

export default async function ProductsPage({ searchParams }: PageProps<"/beheer/artikelen">) {
  await connection();
  const sp = await searchParams;
  const rows = await getDb().rpc<AdminProductRow[]>("api_admin_products", {});
  return (
    <>
      <div className="page-head">
        <h1>Artikelen en prijzen</h1>
        <Link className="btn" href="/beheer/artikelen/nieuwe-bundel">Nieuwe bundel</Link>
      </div>
      <Flash sp={sp} />
      <p className="muted">Prijzen per kanaal apart. Wijzigingen worden vastgelegd in het logboek en laten de voorraad ongemoeid. Bundels zijn alleen voor de webshop.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Artikel</th><th>Status</th><th className="r">Beschikbaar</th><th>Webshopprijs</th><th>bol-prijs</th><th>bol</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/beheer/artikelen/${p.id}`}>{p.title}</Link>
                  <div className="small muted">{p.sku} · {TYPE_LABEL[p.product_type]}{p.ean ? ` · EAN ${p.ean}` : ""}</div>
                  {p.devices.some((d) => !d.confirmed) ? <div className="small" style={{ color: "var(--to-warning)" }}>Compatibiliteit in twijfel: {p.devices.filter((d) => !d.confirmed).map((d) => d.name).join(", ")}</div> : null}
                  {p.bol_title_fix_required ? <div className="small" style={{ color: "var(--to-warning)" }}>bol-titel moet gecorrigeerd worden</div> : null}
                </td>
                <td><Status value={p.status} /></td>
                <td className="r num">{p.available_units}</td>
                <td>
                  <form action={setPriceAction} className="inline-form">
                    <input type="hidden" name="product_id" value={p.id} />
                    <input type="hidden" name="channel" value="web" />
                    <input type="hidden" name="return_to" value="/beheer/artikelen" />
                    <label className="sr-only" htmlFor={`w-${p.id}`}>Webshopprijs {p.sku}</label>
                    <input id={`w-${p.id}`} name="price" type="text" inputMode="decimal" defaultValue={(p.web_price_cents / 100).toFixed(2).replace(".", ",")} />
                    <button className="btn btn-sm btn-secondary">Opslaan</button>
                  </form>
                </td>
                <td>
                  {p.kind === "bundle" ? <span className="muted">alleen webshop</span> : (
                    <form action={setPriceAction} className="inline-form">
                      <input type="hidden" name="product_id" value={p.id} />
                      <input type="hidden" name="channel" value="bol" />
                      <input type="hidden" name="return_to" value="/beheer/artikelen" />
                      <label className="sr-only" htmlFor={`b-${p.id}`}>bol-prijs {p.sku}</label>
                      <input id={`b-${p.id}`} name="price" type="text" inputMode="decimal" defaultValue={p.bol_price_cents != null ? (p.bol_price_cents / 100).toFixed(2).replace(".", ",") : ""} />
                      <button className="btn btn-sm btn-secondary">Opslaan</button>
                    </form>
                  )}
                </td>
                <td>
                  {p.kind === "bundle" ? "–" : p.bol_enabled ? (
                    <>
                      <Status value="active" label="Actief" /> <span className="small">aanbod {p.bol_target_stock}</span>
                      {p.bol_sync.price?.status && p.bol_sync.price.status !== "synced" ? <div className="small">prijs: <Status value={p.bol_sync.price.status} /></div> : null}
                    </>
                  ) : <span className="muted small">Niet actief{p.bol_reference ? ` · ${p.bol_reference}` : ""}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Prijzen: {money(1995)} is de voorlopige standaardprijs; iPhone 15 Plus-privacyset {money(2495)}.</p>
    </>
  );
}
