import Link from "next/link";
import { ProductVisual } from "@/components/product-visual";
import { money, TYPE_LABEL } from "@/lib/format";
import { filterProducts, loadCatalog } from "@/server/queries/catalog";

function StockLine({ units }: { units: number }) {
  if (units <= 0) return <span className="stock-line stock-none">Uitverkocht</span>;
  if (units <= 3) return <span className="stock-line stock-low">Nog {units} op voorraad</span>;
  return <span className="stock-line stock-ok">Op voorraad</span>;
}

export default async function CatalogPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const filter = { q: one(sp.q), toestel: one(sp.toestel), type: one(sp.type) };
  const catalog = await loadCatalog();
  const products = filterProducts(catalog.products, filter);
  const types = [...new Set(catalog.products.map((p) => p.product_type))];
  const families = [...new Set(catalog.devices.map((d) => d.family))];
  const active = filter.q || filter.toestel || filter.type;

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Bescherming voor je iPhone</h1>
          <p>Screenprotectors van 9H gehard glas, privacyfilters en MagSafe-hoesjes. Kies je toestel en zie direct wat past.</p>
        </div>
      </section>
      <div className="container">
        <form className="filters" role="search" action="/" method="get" aria-label="Producten zoeken en filteren">
          <div className="field">
            <label htmlFor="q">Zoeken</label>
            <input id="q" name="q" type="search" defaultValue={filter.q} placeholder="Bijv. iPhone 15 privacy" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="toestel">Toestel</label>
            <select id="toestel" name="toestel" defaultValue={filter.toestel}>
              <option value="">Alle toestellen</option>
              {families.map((fam) => (
                <optgroup key={fam} label={fam}>
                  {catalog.devices
                    .filter((d) => d.family === fam)
                    .map((d) => (
                      <option key={d.slug} value={d.slug}>
                        {d.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="type">Producttype</label>
            <select id="type" name="type" defaultValue={filter.type}>
              <option value="">Alle types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">
            Toon resultaten
          </button>
        </form>

        <div className="page-head">
          <p className="muted" aria-live="polite" style={{ margin: 0 }}>
            {products.length} {products.length === 1 ? "product" : "producten"}
            {active ? " gevonden" : ""}
          </p>
          {active ? (
            <Link href="/" className="small">
              Filters wissen
            </Link>
          ) : null}
        </div>

        {products.length === 0 ? (
          <div className="card">
            <h2>Geen producten gevonden</h2>
            <p className="muted">Probeer een ander toestel of zoekwoord.</p>
          </div>
        ) : (
          <ul className="products" style={{ listStyle: "none", padding: 0 }}>
            {products.map((p) => (
              <li key={p.id} className="product-card">
                <div className="visual">
                  <ProductVisual type={p.product_type} imageUrl={p.image_path} alt="" />
                </div>
                <div className="body">
                  <span className="badge badge-blue" style={{ alignSelf: "flex-start" }}>
                    {TYPE_LABEL[p.product_type]}
                  </span>
                  <h3>
                    <Link href={`/product/${p.slug}`}>{p.title}</Link>
                  </h3>
                  {p.subtitle ? <span className="muted small">{p.subtitle}</span> : null}
                  <span className="muted small">Past op: {p.devices.map((d) => d.name).join(", ")}</span>
                  <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span className="price">{money(p.price_cents)}</span>
                    <StockLine units={p.available_units} />
                  </div>
                  {p.tier_discounts.length ? (
                    <span className="small" style={{ color: "#003d99" }}>
                      {p.tier_discounts[0].name}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
