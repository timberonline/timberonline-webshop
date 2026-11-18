import type { Metadata } from "next";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Winkelwagen", robots: { index: false } };

export default async function CartPage({ searchParams }: PageProps<"/winkelwagen">) {
  const sp = await searchParams;
  const cancelled = typeof sp.geannuleerd === "string" ? sp.geannuleerd : null;
  return (
    <div className="container">
      <h1 style={{ marginTop: 24 }}>Winkelwagen</h1>
      <CartView cancelledOrder={cancelled} />
    </div>
  );
}
