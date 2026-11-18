import { randomBytes } from "node:crypto";
import { renderLabel, type Address } from "../../pdf/labels";

export type Carrier = "dhl" | "postnl" | "letter";

export type LabelRequest = {
  /** Stabiele sleutel per zending; live drivers moeten deze als idempotentiesleutel/labelId aan de vervoerder meegeven. */
  idempotencyKey: string;
  carrier: Carrier;
  orderNumber: string;
  shipDate: string;
  weightG: number | null;
  to: Address;
  from: Address | null;
  lines: { sku: string; qty: number }[];
};

export type LabelResult = {
  pdf: Uint8Array;
  source: "carrier_api" | "simulated" | "letter";
  trackingCode: string | null;
  trackingUrl: string | null;
  carrierReference: string | null;
};

export interface CarrierDriver {
  readonly mode: "simulated" | "live";
  createLabel(req: LabelRequest): Promise<LabelResult>;
}

export function trackingUrl(carrier: Carrier, code: string | null, postalCode?: string | null): string | null {
  if (!code) return null;
  const pc = (postalCode ?? "").replace(/\s/g, "");
  if (carrier === "dhl") return `https://www.dhl.com/nl-nl/home/traceren.html?tracking-id=${encodeURIComponent(code)}`;
  if (carrier === "postnl") return `https://jouw.postnl.nl/track-and-trace/${encodeURIComponent(code)}-NL-${encodeURIComponent(pc)}`;
  return null;
}

/** Testmodus: voorbeeldlabels en gesimuleerde trackingcodes. Briefpost krijgt altijd een adreslabel. */
export function createSimulatedCarriers(): CarrierDriver {
  return {
    mode: "simulated",
    async createLabel(req) {
      if (req.carrier === "letter") return letterLabel(req);
      const code = `${req.carrier === "dhl" ? "SIMDHL" : "SIM3S"}${randomBytes(5).toString("hex").toUpperCase()}`;
      const pdf = await renderLabel({ ...req, trackingCode: code, simulated: true });
      return { pdf, source: "simulated", trackingCode: code, trackingUrl: null, carrierReference: `sim-${code}` };
    },
  };
}

async function letterLabel(req: LabelRequest): Promise<LabelResult> {
  const pdf = await renderLabel({ ...req, trackingCode: null, simulated: false });
  return { pdf, source: "letter", trackingCode: null, trackingUrl: null, carrierReference: null };
}

/**
 * Live koppelingen met DHL (zakelijk) en PostNL zijn nog niet geactiveerd: er zijn geen zakelijke
 * accounts/API-sleutels. Briefpost werkt wel (adreslabel). Zie docs/integraties.md voor de activatiestappen.
 */
export function createLiveCarriers(): CarrierDriver {
  return {
    mode: "live",
    async createLabel(req) {
      if (req.carrier === "letter") return letterLabel(req);
      // Bij implementatie: req.idempotencyKey meesturen (DHL Parcel: labelId; PostNL: eigen referentie) en bij
      // een herhaalde aanvraag eerst het bestaande label bij de vervoerder ophalen in plaats van een nieuw te maken.
      throw new Error(`Koppeling met ${req.carrier === "dhl" ? "DHL" : "PostNL"} is nog niet geactiveerd`);
    },
  };
}
