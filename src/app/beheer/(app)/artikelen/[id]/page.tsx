import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Flash, Status } from "../../_components/ui";
import { money } from "@/lib/format";
import { getDb } from "@/server/db";
import { productImageUrl } from "@/server/storage";
import { setPriceAction } from "../actions";
import { ProductForm, type ProductFull } from "../product-form";

export default async function ProductEdit({ params, searchParams }: PageProps<"/beheer/artikelen/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const [rows, devices, comps] = await Promise.all([
    db.rpc<(ProductFull & { web_price_cents: number; bol_price_cents: number | null; available_units: number; bol_target_stock: number; bol_sync: Record<string, { status: string; last_error: string | null; pushed_value: number | null }> })[]>("api_admin_products", { id }),
    db.rpc<{ slug: string; name: string; family: string }[]>("api_admin_devices", {}),
    db.rpc<{ components: { id: string; code: string; name: string; kind: string; free: number }[] }>("api_admin_components", { limit: 1 }),
  ]);
  const p = rows[0];
  if (!p) notFound();
  return (
    <>
      <div className="page-head">
        <h1>{p.title}</h1>
        <Link href="/beheer/artikelen">← Alle artikelen</Link>
      </div>
      <Flash sp={sp} />
      {p.review_note ? <p className="notice notice-warn">{p.review_note}</p> : null}
      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: "1.125rem" }}>Prijzen per kanaal</h2>
        <div className="row">
          <form action={setPriceAction} className="row">
            <input type="hidden" name="product_id" value={p.id} />
            <input type="hidden" name="channel" value="web" />
            <div><label htmlFor="pw">Webshop (nu {money(p.web_price_cents)})</label><input id="pw" name="price" type="text" inputMode="decimal" defaultValue={(p.web_price_cents / 100).toFixed(2).replace(".", ",")} /></div>
            <button className="btn btn-secondary" style={{ flex: "0 0 auto" }}>Opslaan</button>
          </form>
          {p.kind !== "bundle" ? (
            <form action={setPriceAction} className="row">
              <input type="hidden" name="product_id" value={p.id} />
              <input type="hidden" name="channel" value="bol" />
              <div><label htmlFor="pb">bol (nu {money(p.bol_price_cents)})</label><input id="pb" name="price" type="text" inputMode="decimal" defaultValue={p.bol_price_cents != null ? (p.bol_price_cents / 100).toFixed(2).replace(".", ",") : ""} /></div>
              <button className="btn btn-secondary" style={{ flex: "0 0 auto" }}>Opslaan</button>
            </form>
          ) : null}
        </div>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          Beschikbaar: {p.available_units} verkoopbare eenheden{p.kind !== "bundle" ? ` · bol-aanbod volgens buffer: ${p.bol_target_stock}` : ""}
          {p.bol_sync.stock ? <> · bol-voorraad <Status value={p.bol_sync.stock.status} /></> : null}
          {p.bol_sync.price ? <> · bol-prijs <Status value={p.bol_sync.price.status} /></> : null}
        </p>
      </section>
      <ProductForm product={p} devices={devices} components={comps.components} imageUrl={productImageUrl(p.image_path)} />
    </>
  );
}
