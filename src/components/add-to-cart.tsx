"use client";
import Link from "next/link";
import { useState } from "react";
import { addToCart } from "./cart-store";

export function AddToCart({ productId, max }: { productId: string; max: number }) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const limit = Math.max(0, Math.min(20, max));
  if (limit === 0) {
    return <p className="stock-none" style={{ fontWeight: 600 }}>Dit artikel is uitverkocht.</p>;
  }
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "center" }}>
        <div style={{ flex: "0 0 auto" }}>
          <label htmlFor="qty">Aantal</label>
          <div className="qty">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Eén minder" disabled={qty <= 1}>
              −
            </button>
            <input
              id="qty"
              inputMode="numeric"
              value={qty}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ""));
                setQty(Math.max(1, Math.min(limit, Number.isFinite(n) && n > 0 ? n : 1)));
              }}
              aria-describedby="qty-hint"
            />
            <button type="button" onClick={() => setQty((q) => Math.min(limit, q + 1))} aria-label="Eén meer" disabled={qty >= limit}>
              +
            </button>
          </div>
          <span id="qty-hint" className="field-hint">
            Maximaal {limit}
          </span>
        </div>
        <button
          type="button"
          className="btn"
          style={{ flex: "1 1 220px" }}
          onClick={() => {
            addToCart(productId, qty);
            setAdded(true);
          }}
        >
          In winkelwagen
        </button>
      </div>
      <p role="status" aria-live="polite" style={{ minHeight: 24, margin: 0 }}>
        {added ? (
          <>
            Toegevoegd aan je winkelwagen. <Link href="/winkelwagen">Naar winkelwagen</Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
