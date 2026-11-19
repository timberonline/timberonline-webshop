import Link from "next/link";
import { connection } from "next/server";
import { Flash } from "../_components/ui";
import { dateTime } from "@/lib/format";
import { requireAdminPage, ROLES } from "@/server/auth/admin";
import { getDb } from "@/server/db";
import { handleWithdrawalAction, retryWithdrawalAckAction } from "./actions";

type Row = {
  id: string; reference: string; order_id: string | null; order_ref: string | null; order_number: string; name: string; email: string;
  scope: "all" | "partial"; items: string | null; note: string | null; submitted_at: string; ack_status: string; ack_sent_at: string | null;
  ack_stale: boolean; ack_attempts: number; ack_error: string | null;
  status: "received" | "handled" | "rejected"; handled_at: string | null; handled_by: string | null; handled_note: string | null;
};

const STATUS: Record<Row["status"], string> = { received: "Open", handled: "Afgehandeld", rejected: "Afgewezen" };
const ACK: Record<string, string> = { pending: "Nog niet verstuurd", sending: "Wordt verstuurd", sent: "Verstuurd", simulated: "Gesimuleerd", failed: "Mislukt" };

export default async function WithdrawalsPage({ searchParams }: PageProps<"/beheer/herroepingen">) {
  await requireAdminPage(ROLES.orders);
  await connection();
  const sp = await searchParams;
  const rows = await getDb().rpc<Row[]>("api_admin_withdrawals", {});
  const open = rows.filter((r) => r.status === "received");
  return (
    <>
      <div className="page-head"><h1>Herroepingen</h1></div>
      <Flash sp={sp} />
      <p className="small muted">
        Herroepingen via de online herroepingsfunctie op de website. De klant krijgt automatisch een ontvangstbevestiging. Handel de retour en
        terugbetaling af via de order (Retouren en Refund) en zet de herroeping daarna op afgehandeld. Terugbetalen binnen 14 dagen na ontvangst van
        de herroeping; je mag wachten tot de artikelen terug zijn of de klant aantoont dat ze zijn teruggestuurd.
      </p>
      <h2 style={{ fontSize: "1.25rem" }}>Open ({open.length})</h2>
      {rows.length === 0 ? <p className="card muted">Nog geen herroepingen ontvangen.</p> : null}
      <div className="stack">
        {rows.map((r) => (
          <article key={r.id} className="card" aria-labelledby={`w-${r.id}`}>
            <h3 id={`w-${r.id}`} style={{ margin: "0 0 6px", fontSize: "1.0625rem" }}>
              {r.reference} · <span className={`badge ${r.status === "received" ? "badge-warn" : "badge-ok"}`}>{STATUS[r.status]}</span>
            </h3>
            <dl className="dl">
              <dt>Ontvangen</dt>
              <dd>{dateTime(r.submitted_at)}</dd>
              <dt>Bestelling</dt>
              <dd>
                {r.order_id ? <Link href={`/beheer/orders/${r.order_id}`}>{r.order_ref ?? r.order_number}</Link> : <>{r.order_number} <span className="badge badge-danger">Geen webshoporder met dit nummer en e-mailadres: handmatig nagaan</span></>}
              </dd>
              <dt>Klant</dt>
              <dd>{r.name} · {r.email}</dd>
              <dt>Omvang</dt>
              <dd>{r.scope === "all" ? "Hele bestelling" : `Deel: ${r.items ?? ""}`}</dd>
              {r.note ? (<><dt>Toelichting</dt><dd style={{ whiteSpace: "pre-wrap" }}>{r.note}</dd></>) : null}
              <dt>Ontvangstbevestiging</dt>
              <dd>
                {r.ack_stale ? "Vastgelopen" : ACK[r.ack_status] ?? r.ack_status}
                {r.ack_sent_at ? ` · ${dateTime(r.ack_sent_at)}` : ""}
                {r.ack_attempts > 1 ? ` · ${r.ack_attempts} pogingen` : ""}
                {r.ack_error && r.ack_status === "failed" ? ` · ${r.ack_error}` : ""}
              </dd>
              {r.handled_at ? (<><dt>Afgehandeld</dt><dd>{dateTime(r.handled_at)} door {r.handled_by}{r.handled_note ? ` · ${r.handled_note}` : ""}</dd></>) : null}
            </dl>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              {["pending", "failed"].includes(r.ack_status) || r.ack_stale ? (
                <form action={retryWithdrawalAckAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn btn-secondary btn-sm">Bevestiging opnieuw versturen</button>
                </form>
              ) : null}
              <form action={handleWithdrawalAction} className="inline-form">
                <input type="hidden" name="id" value={r.id} />
                <label htmlFor={`note-${r.id}`} className="sr-only">Notitie</label>
                <input id={`note-${r.id}`} name="note" type="text" placeholder="Notitie (optioneel)" defaultValue={r.handled_note ?? ""} style={{ width: "auto" }} />
                {r.status === "received" ? (
                  <>
                    <button className="btn btn-sm" name="status" value="handled">Afgehandeld</button>
                    <button className="btn btn-secondary btn-sm" name="status" value="rejected">Afwijzen</button>
                  </>
                ) : (
                  <button className="btn btn-secondary btn-sm" name="status" value="received">Weer open zetten</button>
                )}
              </form>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
