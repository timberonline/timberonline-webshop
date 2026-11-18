import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ClearCart } from "./clear-cart";
import { money } from "@/lib/format";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Bedankt voor je bestelling", robots: { index: false } };

type PublicOrder = {
  number: string;
  payment_status: string;
  stock_status: string;
  total_cents: number;
  discount_cents: number;
  shipping_cents: number;
  delivery_promise: string | null;
  lines: { title: string; qty: number; line_total_cents: number }[];
} | null;

export default async function ThanksPage({ searchParams }: PageProps<"/bestelling/bedankt">) {
  await connection();
  const sp = await searchParams;
  const orderId = typeof sp.order === "string" && /^[0-9a-f-]{36}$/.test(sp.order) ? sp.order : null;
  const sessionId = typeof sp.session_id === "string" ? sp.session_id : null;
  const order = orderId && sessionId ? await getDb().rpc<PublicOrder>("api_order_public", { order_id: orderId, session_id: sessionId }) : null;

  if (!order) {
    return (
      <div className="container" style={{ margin: "32px auto" }}>
        <div className="card">
          <h1>Bestelling niet gevonden</h1>
          <p>We konden deze bestelling niet tonen. Heb je betaald? Dan ontvang je een bevestiging per e-mail.</p>
          <Link href="/">Terug naar de winkel</Link>
        </div>
      </div>
    );
  }
  const paid = order.payment_status === "paid";
  return (
    <div className="container" style={{ margin: "32px auto", maxWidth: 720 }}>
      {paid ? <ClearCart /> : null}
      <div className="card stack">
        <h1>{paid ? "Bedankt voor je bestelling" : "We verwerken je betaling"}</h1>
        <p>
          Bestelnummer <strong>{order.number}</strong>.{" "}
          {paid
            ? "Je ontvangt een bevestiging per e-mail."
            : "Zodra de betaling is bevestigd, ontvang je een e-mail. Ververs deze pagina over een moment."}
        </p>
        {order.stock_status === "shortage" ? (
          <p className="notice notice-warn">Er is een voorraadprobleem met je bestelling. We nemen zo snel mogelijk contact met je op.</p>
        ) : null}
        <ul>
          {order.lines.map((l, i) => (
            <li key={i}>
              {l.qty} × {l.title} — {money(l.line_total_cents)}
            </li>
          ))}
        </ul>
        <p>
          Totaal: <strong>{money(order.total_cents)}</strong>
          {order.discount_cents ? ` (incl. ${money(order.discount_cents)} korting)` : ""}
        </p>
        <p className="muted">{order.delivery_promise}</p>
        <Link href="/">Verder winkelen</Link>
      </div>
    </div>
  );
}
