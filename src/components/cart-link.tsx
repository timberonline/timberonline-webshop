"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { onCartChange, readCart } from "./cart-store";

function count() {
  return readCart().reduce((s, l) => s + l.qty, 0);
}

export function CartLink() {
  const n = useSyncExternalStore(onCartChange, count, () => 0);
  return (
    <Link href="/winkelwagen" className="cart-link">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="18" cy="20" r="1.5" />
        <path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.8a1.5 1.5 0 0 0 1.5-1.1L21 7H6" />
      </svg>
      <span>Winkelwagen</span>
      <span className="cart-count" aria-label={`${n} artikelen`}>
        {n}
      </span>
    </Link>
  );
}
