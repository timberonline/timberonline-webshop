const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

export function money(cents: number | null | undefined): string {
  return eur.format((cents ?? 0) / 100);
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(new Date(value));
}

export function parseEuroToCents(input: string): number | null {
  const m = input.trim().replace(/^€\s*/, "").match(/^(\d{1,4})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export const CARRIER_LABEL: Record<string, string> = { dhl: "DHL", postnl: "PostNL", letter: "Briefpost" };

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  draft: "Concept",
  label_ready: "Label klaar",
  handed_over: "Overgedragen",
  in_transit: "Onderweg",
  ready_for_pickup: "Klaar om af te halen",
  delivered: "Bezorgd",
  exception: "Uitzondering",
  cancelled: "Geannuleerd",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Wacht op betaling",
  paid: "Betaald",
  expired: "Verlopen",
  cancelled: "Geannuleerd",
  failed: "Mislukt",
  refunded: "Terugbetaald",
  partially_refunded: "Deels terugbetaald",
};

export const STOCK_STATUS_LABEL: Record<string, string> = {
  reserved: "Gereserveerd",
  committed: "Afgeboekt",
  released: "Vrijgegeven",
  shortage: "Tekort",
};

export const FULFILLMENT_LABEL: Record<string, string> = {
  unfulfilled: "Te verzenden",
  label_ready: "Label klaar",
  shipped: "Verzonden",
  delivered: "Bezorgd",
  ready_for_pickup: "Klaar om af te halen",
  cancelled: "Geannuleerd",
  returned: "Geretourneerd",
};

export const TYPE_LABEL: Record<string, string> = {
  screenprotector: "Screenprotector",
  privacy: "Privacy-screenprotector",
  hoesje: "Hoesje",
  bundel: "Bundel",
};
