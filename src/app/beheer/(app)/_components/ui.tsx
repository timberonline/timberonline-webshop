import { CARRIER_LABEL, FULFILLMENT_LABEL, PAYMENT_STATUS_LABEL, SHIPMENT_STATUS_LABEL, STOCK_STATUS_LABEL } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;

export function Flash({ sp }: { sp: SP }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const fout = typeof sp.fout === "string" ? sp.fout : null;
  if (!ok && !fout) return null;
  return (
    <p className={`notice ${fout ? "notice-danger" : "notice-ok"}`} role={fout ? "alert" : "status"}>
      {fout ?? ok}
    </p>
  );
}

const TONE: Record<string, string> = {
  paid: "badge-ok", committed: "badge-ok", delivered: "badge-ok", synced: "badge-ok", sent: "badge-ok", succeeded: "badge-ok", active: "badge-ok", done: "badge-ok", label_ready: "badge-blue", handed_over: "badge-blue", in_transit: "badge-blue", ready_for_pickup: "badge-blue", shipped: "badge-blue", reserved: "badge-blue",
  pending: "badge-warn", in_flight: "badge-warn", submitted: "badge-warn", concept: "badge-warn", unfulfilled: "badge-warn", draft: "badge-warn", simulated: "badge-warn", partially_refunded: "badge-warn",
  failed: "badge-danger", shortage: "badge-danger", exception: "badge-danger", expired: "", cancelled: "", released: "", refunded: "", archived: "",
};

const LABELS: Record<string, string> = {
  ...PAYMENT_STATUS_LABEL, ...STOCK_STATUS_LABEL, ...FULFILLMENT_LABEL, ...SHIPMENT_STATUS_LABEL,
  synced: "Verwerkt", in_flight: "Bezig", submitted: "Ingediend", concept: "Concept", active: "Actief", archived: "Gearchiveerd", sent: "Verstuurd", simulated: "Gesimuleerd", succeeded: "Gelukt", done: "Klaar", sending: "Bezig",
  ...CARRIER_LABEL,
};

export function Status({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="muted">–</span>;
  return <span className={`badge ${TONE[value] ?? ""}`}>{label ?? LABELS[value] ?? value}</span>;
}
