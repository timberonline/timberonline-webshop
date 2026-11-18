import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { ProductVisual } from "@/components/product-visual";
import { money, TYPE_LABEL } from "@/lib/format";
import { loadCatalog } from "@/server/queries/catalog";

export default async function ProductPage({ params }: PageProps<"/product/[slug]">) {
  const { slug } = await params;
  const catalog = await loadCatalog();
  const p = catalog.products.find((x) => x.slug === slug);
  if (!p) notFound();
  const related = catalog.products.filter((x) => x.id !== p.id && x.devices.some((d) => p.devices.some((pd) => pd.slug === d.slug)));
  const opt = catalog.settings.shipping_options.find((o) => o.enabled) ?? null;

  return (
    <div className="container">
      <nav aria-label="Kruimelpad" className="small" style={{ marginTop: 16 }}>
        <Link href="/">Alle producten</Link> <span aria-hidden="true">›</span> <span>{p.title}</span>
      </nav>
      <div className="detail">
        <div className="visual">
          <ProductVisual type={p.product_type} imageUrl={p.image_path} size={260} alt={`Illustratie ${p.title}`} />
        </div>
        <div className="stack">
          <span className="badge badge-blue">{TYPE_LABEL[p.product_type]}</span>
          <h1 style={{ marginTop: 8 }}>{p.title}</h1>
          {p.subtitle ? <p className="muted">{p.subtitle}</p> : null}
          <p className="price" style={{ fontSize: "1.75rem", margin: 0 }}>
            {money(p.price_cents)}
          </p>
          {p.tier_discounts.map((d) => (
            <p key={d.id} className="notice notice-info" style={{ margin: 0 }}>
              {d.name}: {d.discount_type === "percent" ? `${d.value}% korting` : `${money(d.value)} korting per stuk`} vanaf {d.min_qty} stuks.
            </p>
          ))}
          <AddToCart productId={p.id} max={p.available_units} />
          <section aria-labelledby="compat">
            <h2 id="compat" style={{ fontSize: "1.125rem" }}>
              Past op
            </h2>
            <ul className="compat">
              {p.devices.map((d) => (
                <li key={d.slug} className="badge">
                  {d.name}
                </li>
              ))}
            </ul>
          </section>
          {p.description ? (
            <section aria-labelledby="omschrijving">
              <h2 id="omschrijving" style={{ fontSize: "1.125rem" }}>
                Omschrijving
              </h2>
              <p>{p.description}</p>
            </section>
          ) : null}
          <section aria-labelledby="inhoud-set">
            <h2 id="inhoud-set" style={{ fontSize: "1.125rem" }}>
              In de verpakking
            </h2>
            <ul>
              {p.components.map((c, i) => (
                <li key={i}>
                  {c.qty} × {c.name}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="levering" className="card" style={{ boxShadow: "none", border: "1px solid var(--to-border)" }}>
            <h2 id="levering" style={{ fontSize: "1.125rem" }}>
              Levering
            </h2>
            <p style={{ margin: "0 0 6px" }}>{catalog.settings.delivery_promise}</p>
            {opt ? (
              <p style={{ margin: "0 0 6px" }}>
                {opt.label}: {opt.cost_cents ? money(opt.cost_cents) : "gratis"}
              </p>
            ) : null}
            <p className="muted small" style={{ margin: 0 }}>
              {catalog.settings.tracking_info}
            </p>
          </section>
          <p className="muted small">
            Artikelnummer {p.sku}
            {p.ean ? ` · EAN ${p.ean}` : ""}
          </p>
        </div>
      </div>
      {related.length ? (
        <section aria-labelledby="ook" style={{ marginBottom: 32 }}>
          <h2 id="ook">Ook voor dit toestel</h2>
          <ul className="products" style={{ listStyle: "none", padding: 0 }}>
            {related.map((r) => (
              <li key={r.id} className="product-card">
                <div className="body">
                  <h3>
                    <Link href={`/product/${r.slug}`}>{r.title}</Link>
                  </h3>
                  <span className="muted small">{r.subtitle}</span>
                  <span className="price">{money(r.price_cents)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
