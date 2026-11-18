"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { onCartChange, readCart, writeCart, type CartLine } from "@/components/cart-store";
import { ProductVisual } from "@/components/product-visual";
import { money } from "@/lib/format";
import type { Quote } from "@/server/services/types";
import { cancelAction, checkoutAction, quoteAction } from "./actions";

const ERRORS: Record<string, string> = {
  product_unavailable: "Een artikel is niet meer beschikbaar en is uit je winkelwagen gehaald.",
  invalid_qty: "Een aantal is ongeldig.",
  shipping_option_unavailable: "Deze verzendoptie is niet beschikbaar.",
  shipping_option_not_allowed: "Deze verzendoptie kan niet voor alle artikelen in je winkelwagen.",
  invalid_input: "Je winkelwagen kon niet worden gelezen.",
};

let snapshot = "[]";
function getSnapshot() {
  const next = JSON.stringify(readCart());
  if (next !== snapshot) snapshot = next;
  return snapshot;
}

export function CartView({ cancelledOrder }: { cancelledOrder: string | null }) {
  const raw = useSyncExternalStore(onCartChange, getSnapshot, () => "[]");
  const lines = JSON.parse(raw) as CartLine[];
  const [option, setOption] = useState("tracked");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [paying, startPaying] = useTransition();

  useEffect(() => {
    if (cancelledOrder) void cancelAction(cancelledOrder);
  }, [cancelledOrder]);

  useEffect(() => {
    if (lines.length === 0) return;
    startLoading(async () => {
      const q = await quoteAction(lines, option);
      if ("lines" in q) {
        setQuote(q);
        setError(q.errors?.length ? q.errors.map((e) => ERRORS[e.code] ?? e.code).join(" ") : null);
        const bad = q.errors?.filter((e) => e.code === "product_unavailable").map((e) => (e as { product_id?: string }).product_id);
        if (bad?.length) writeCart(lines.filter((l) => !bad.includes(l.product_id)));
      } else {
        setQuote(null);
        const bad = q.errors.map((e) => ERRORS[e.code] ?? e.code);
        setError(bad.join(" "));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, option]);

  function setQty(productId: string, qty: number) {
    writeCart(lines.map((l) => (l.product_id === productId ? { ...l, qty: Math.max(0, Math.min(20, qty)) } : l)));
  }

  if (lines.length === 0) {
    return (
      <div className="card">
        {cancelledOrder ? <p className="notice notice-info">Je betaling is afgebroken. Er is niets afgeschreven.</p> : null}
        <h2>Je winkelwagen is leeg</h2>
        <p>
          <Link href="/" className="btn">
            Bekijk producten
          </Link>
        </p>
      </div>
    );
  }

  const canPay = !!quote && quote.ok && quote.stock_ok && !loading && !paying;

  return (
    <div className="layout-2">
      <section className="card" aria-labelledby="artikelen">
        <h2 id="artikelen" style={{ fontSize: "1.25rem" }}>
          Artikelen
        </h2>
        {cancelledOrder ? <p className="notice notice-info">Je betaling is afgebroken. Er is niets afgeschreven; je winkelwagen staat nog klaar.</p> : null}
        {quote?.lines.map((l) => {
          const short = quote.shortages.length > 0 && l.available_units < l.qty;
          return (
            <div key={l.product_id} className="cart-line">
              <div className="thumb">
                <ProductVisual type={l.kind === "bundle" ? "bundel" : l.kind === "case" ? "hoesje" : "screenprotector"} size={48} alt="" />
              </div>
              <div>
                <Link href={`/product/${l.slug}`} style={{ fontWeight: 600, color: "var(--to-anthracite)" }}>
                  {l.title}
                </Link>
                <div className="meta" style={{ marginTop: 6 }}>
                  <div className="qty" role="group" aria-label={`Aantal ${l.title}`}>
                    <button type="button" onClick={() => setQty(l.product_id, l.qty - 1)} aria-label="Eén minder">
                      −
                    </button>
                    <input
                      value={l.qty}
                      inputMode="numeric"
                      aria-label="Aantal"
                      onChange={(e) => setQty(l.product_id, Number(e.target.value.replace(/\D/g, "")) || 1)}
                    />
                    <button type="button" onClick={() => setQty(l.product_id, l.qty + 1)} aria-label="Eén meer" disabled={l.qty >= 20}>
                      +
                    </button>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {l.discount_cents ? (
                      <div className="small muted">
                        <s>{money(l.unit_price_cents * l.qty)}</s>
                      </div>
                    ) : null}
                    <strong className="num">{money(l.line_total_cents)}</strong>
                  </div>
                </div>
                {l.discount_cents ? (
                  <p className="small" style={{ color: "#003d99", margin: "4px 0 0" }}>
                    {l.discount_rule_name}: −{money(l.discount_cents)}
                  </p>
                ) : null}
                {short ? <p className="small stock-none" style={{ margin: "4px 0 0" }}>Nog {l.available_units} beschikbaar</p> : null}
                <button type="button" className="link-btn small" style={{ marginTop: 6 }} onClick={() => setQty(l.product_id, 0)}>
                  Verwijderen
                </button>
              </div>
            </div>
          );
        })}
        {quote && !quote.stock_ok ? (
          <p className="notice notice-warn" role="alert" style={{ marginTop: 16 }}>
            Niet alles is in deze aantallen op voorraad
            {quote.shortages.map((s) => ` (${s.name}: nog ${s.available} stuks)`).join("")}. Pas de aantallen aan om af te rekenen.
          </p>
        ) : null}
      </section>

      <aside className="card summary" aria-labelledby="overzicht">
        <h2 id="overzicht" style={{ fontSize: "1.25rem" }}>
          Overzicht
        </h2>
        <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Verzending</legend>
          {(quote?.shipping_options ?? []).map((o) => (
            <label key={o.code} className="check" style={{ fontWeight: 500 }}>
              <input type="radio" name="shipping" value={o.code} checked={option === o.code} onChange={() => setOption(o.code)} />
              <span>
                {o.label} · {o.cost_cents ? money(o.cost_cents) : "gratis"}
                <br />
                <span className="small muted">
                  {o.description}
                  {o.delivery ? ` · ${o.delivery}` : ""}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {quote ? (
          <dl aria-live="polite">
            <dt>Subtotaal</dt>
            <dd>{money(quote.subtotal_cents)}</dd>
            {quote.discount_cents ? (
              <>
                <dt>Korting</dt>
                <dd>−{money(quote.discount_cents)}</dd>
              </>
            ) : null}
            <dt>Verzendkosten</dt>
            <dd>{quote.shipping_cents ? money(quote.shipping_cents) : "Gratis"}</dd>
            <dt className="total">Totaal (incl. btw)</dt>
            <dd className="total">{money(quote.total_cents)}</dd>
          </dl>
        ) : (
          <p className="muted">{loading ? "Berekenen…" : ""}</p>
        )}
        <div style={{ margin: "16px 0" }} className="small">
          <p style={{ margin: "0 0 6px" }}>
            <strong>Levertermijn:</strong> {quote?.delivery_promise ?? "–"}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Tracking:</strong>{" "}
            {quote?.shipping_option?.tracking === false
              ? "Briefpost heeft geen track & trace. We mailen je zodra de brief is gepost."
              : "Je ontvangt een track & trace-code per e-mail zodra je zending aan de vervoerder is overgedragen."}
          </p>
        </div>
        {error ? (
          <p className="notice notice-danger" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-block"
          disabled={!canPay}
          onClick={() =>
            startPaying(async () => {
              setError(null);
              const res = await checkoutAction(lines, option);
              if (res.ok) window.location.assign(res.url);
              else setError(res.message);
            })
          }
        >
          {paying ? "Betaalpagina openen…" : "Afrekenen"}
        </button>
        <p className="small muted" style={{ marginTop: 10 }}>
          Je rekent af als gast bij Stripe met iDEAL | Wero of een andere beschikbare methode. Daar vul je ook je bezorgadres in. Je artikelen zijn 30 minuten
          voor je gereserveerd.
        </p>
      </aside>
    </div>
  );
}
