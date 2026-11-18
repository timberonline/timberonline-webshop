"use client";

export type CartLine = { product_id: string; qty: number };
const KEY = "to-cart-v1";
const EVENT = "to-cart-change";

export function readCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => typeof l.product_id === "string" && Number.isInteger(l.qty) && l.qty > 0) : [];
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines.filter((l) => l.qty > 0)));
  } catch {
    // opslag geblokkeerd: winkelwagen blijft alleen in deze sessie
  }
  window.dispatchEvent(new Event(EVENT));
}

export function addToCart(productId: string, qty: number) {
  const lines = readCart();
  const found = lines.find((l) => l.product_id === productId);
  if (found) found.qty = Math.min(20, found.qty + qty);
  else lines.push({ product_id: productId, qty: Math.min(20, qty) });
  writeCart(lines);
}

export function onCartChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
