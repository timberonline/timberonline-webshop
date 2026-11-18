import type { Db } from "../../db/types";

export type BolOfferRef = { offerId: string | null; reference: string | null; ean: string | null };
export type BolPushResult = { status: "done" } | { status: "submitted"; processId: string };
export type BolProcessResult = { status: "done" } | { status: "pending" } | { status: "failed"; error: string; permanent?: boolean };

export type BolOrder = {
  bol_order_id: string;
  placed_at?: string;
  ship_deadline?: string | null;
  customer?: Record<string, string | null>;
  items: { order_item_id: string; offer_id?: string | null; ean?: string | null; reference?: string | null; qty: number; unit_price_cents: number }[];
};

export interface BolDriver {
  readonly mode: "simulated" | "live";
  updateStock(ref: BolOfferRef, amount: number): Promise<BolPushResult>;
  updatePrice(ref: BolOfferRef, priceCents: number): Promise<BolPushResult>;
  checkProcess(processId: string): Promise<BolProcessResult>;
  confirmShipment(input: { orderItemIds: string[]; carrier: string; trackingCode: string | null }): Promise<BolPushResult>;
  fetchOpenOrders(): Promise<BolOrder[]>;
  /** Actuele stand bij bol (voor reconciliatie); null als het aanbod niet bestaat. */
  readOffer(ref: BolOfferRef): Promise<{ stock: number | null; priceCents: number | null } | null>;
}

/**
 * Fout van de bol-API. `permanent` = opnieuw proberen heeft geen zin (bv. 400/404/422 of ontbrekende offerId);
 * zulke updates worden in de wachtrij direct als mislukt getoond in plaats van vijf keer herhaald.
 */
export class BolApiError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "BolApiError";
  }
}

/** 401 (token verlopen), 408, 409, 425, 429 en 5xx zijn herstelbaar; overige 4xx zijn definitief. */
export function isPermanentHttpStatus(status: number) {
  return status >= 400 && status < 500 && ![401, 408, 409, 425, 429].includes(status);
}

export function offerKey(ref: BolOfferRef) {
  return ref.offerId ?? (ref.reference ? `ref:${ref.reference}` : `ean:${ref.ean}`);
}

/**
 * Gesimuleerde bol-omgeving voor testmodus: houdt aanbod bij in bol_sim_offers.
 * `faults` maakt vertraagde of mislukte updates na te bootsen in tests.
 */
export function createSimulatedBol(
  db: Db,
  faults: { failNext?: number; delayMs?: number; submitted?: boolean; permanentNext?: number } = {},
): BolDriver & { faults: typeof faults; shipments: unknown[] } {
  const shipments: unknown[] = [];
  const maybeFail = async () => {
    if (faults.delayMs) await new Promise((r) => setTimeout(r, faults.delayMs));
    if (faults.permanentNext && faults.permanentNext > 0) {
      faults.permanentNext -= 1;
      throw new BolApiError("Gesimuleerde bol-fout (HTTP 422): ongeldig aanbod", true, 422);
    }
    if (faults.failNext && faults.failNext > 0) {
      faults.failNext -= 1;
      throw new BolApiError("Gesimuleerde bol-fout (HTTP 503)", false, 503);
    }
  };
  return {
    mode: "simulated",
    faults,
    shipments,
    async updateStock(ref, amount) {
      await maybeFail();
      await db.rpc("api_bol_sim_apply", { offer_key: offerKey(ref), stock: amount });
      return faults.submitted ? { status: "submitted", processId: `sim-${Date.now()}` } : { status: "done" };
    },
    async updatePrice(ref, priceCents) {
      await maybeFail();
      await db.rpc("api_bol_sim_apply", { offer_key: offerKey(ref), price_cents: priceCents });
      return { status: "done" };
    },
    async checkProcess() {
      return { status: "done" };
    },
    async confirmShipment(input) {
      await maybeFail();
      shipments.push(input);
      return { status: "done" };
    },
    async fetchOpenOrders() {
      return [];
    },
    async readOffer(ref) {
      const all = await db.rpc<{ offer_key: string; stock: number | null; price_cents: number | null }[]>("api_bol_sim_read", {});
      const o = all.find((x) => x.offer_key === offerKey(ref));
      return o ? { stock: o.stock, priceCents: o.price_cents } : null;
    },
  };
}

const TRANSPORTER: Record<string, string> = { dhl: "DHLFORYOU", postnl: "TNT", letter: "BRIEFPOST" };
const V10 = "application/vnd.retailer.v10+json";

/**
 * bol Retailer API v10. Niet geactiveerd (BOL_MODE=simulated) tot de eigenaar de API-sleutels levert
 * en de gekoppelde aanbiedingen en beginstanden zijn gecontroleerd.
 */
export function createLiveBol(opts: { clientId: string; clientSecret: string; fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number }): BolDriver {
  const raw = opts.fetchImpl ?? fetch;
  // Harde time-out: een verzoek kan nooit langer lopen dan de claimtermijn (2 min) van de sync-wachtrij.
  const f = (url: string, init: RequestInit) => raw(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
  const base = opts.baseUrl ?? "https://api.bol.com";
  let token: { value: string; exp: number } | null = null;

  async function auth() {
    if (token && token.exp > Date.now() + 30_000) return token.value;
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
    const res = await f("https://login.bol.com/token?grant_type=client_credentials", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
    if (!res.ok) throw new BolApiError(`bol-authenticatie mislukt (HTTP ${res.status})`, false, res.status);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
    return token.value;
  }
  async function call(method: string, path: string, body?: unknown) {
    const res = await f(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await auth()}`, Accept: V10, ...(body ? { "Content-Type": V10 } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      if (res.status === 401) token = null; // token ingetrokken of verlopen: volgende poging haalt een nieuw token
      throw new BolApiError(
        `bol ${method} ${path} mislukt (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`,
        isPermanentHttpStatus(res.status),
        res.status,
      );
    }
    return res.status === 204 ? null : res.json();
  }
  const submitted = (json: unknown): BolPushResult => {
    const id = (json as { processStatusId?: string } | null)?.processStatusId;
    return id ? { status: "submitted", processId: String(id) } : { status: "done" };
  };
  const requireOffer = (ref: BolOfferRef) => {
    if (!ref.offerId) throw new BolApiError("bol-offerId ontbreekt voor dit artikel", true);
    return encodeURIComponent(ref.offerId);
  };
  return {
    mode: "live",
    async updateStock(ref, amount) {
      return submitted(await call("PUT", `/retailer/offers/${requireOffer(ref)}/stock`, { amount, managedByRetailer: true }));
    },
    async updatePrice(ref, priceCents) {
      return submitted(
        await call("PUT", `/retailer/offers/${requireOffer(ref)}/price`, {
          pricing: { bundlePrices: [{ quantity: 1, unitPrice: priceCents / 100 }] },
        }),
      );
    },
    async checkProcess(processId) {
      const json = (await call("GET", `/shared/process-status/${encodeURIComponent(processId)}`)) as { status: string; errorMessage?: string };
      if (json.status === "SUCCESS") return { status: "done" };
      if (json.status === "PENDING") return { status: "pending" };
      // FAILURE = door bol afgewezen (bv. validatie): niet blind herhalen. TIMEOUT e.d. zijn herstelbaar.
      return { status: "failed", error: json.errorMessage ?? json.status, permanent: json.status === "FAILURE" };
    },
    async confirmShipment(input) {
      return submitted(
        await call("PUT", "/retailer/orders/shipment", {
          orderItems: input.orderItemIds.map((orderItemId) => ({ orderItemId })),
          transport: { transporterCode: TRANSPORTER[input.carrier] ?? "OTHER", ...(input.trackingCode ? { trackAndTrace: input.trackingCode } : {}) },
        }),
      );
    },
    async fetchOpenOrders() {
      // bol levert open orders per pagina (max. 50); alle pagina's ophalen, met een harde bovengrens
      const ids: string[] = [];
      for (let page = 1; page <= 20; page++) {
        const list = (await call("GET", `/retailer/orders?fulfilment-method=FBR&status=OPEN&page=${page}`)) as { orders?: { orderId: string }[] } | null;
        const batch = list?.orders ?? [];
        ids.push(...batch.map((o) => o.orderId));
        if (batch.length < 50) break;
      }
      const out: BolOrder[] = [];
      for (const o of [...new Set(ids)].map((orderId) => ({ orderId }))) {
        const d = (await call("GET", `/retailer/orders/${encodeURIComponent(o.orderId)}`)) as {
          orderId: string;
          orderPlacedDateTime: string;
          shipmentDetails?: { firstName?: string; surname?: string; streetName?: string; houseNumber?: string; houseNumberExtension?: string; zipCode?: string; city?: string; countryCode?: string };
          orderItems: { orderItemId: string; quantity: number; unitPrice: number; offer?: { offerId?: string; reference?: string }; product?: { ean?: string }; fulfilment?: { latestDeliveryDate?: string } }[];
        };
        const s = d.shipmentDetails ?? {};
        out.push({
          bol_order_id: d.orderId,
          placed_at: d.orderPlacedDateTime,
          ship_deadline: d.orderItems[0]?.fulfilment?.latestDeliveryDate ?? null,
          customer: {
            name: [s.firstName, s.surname].filter(Boolean).join(" "),
            street: s.streetName ?? null,
            house_number: [s.houseNumber, s.houseNumberExtension].filter(Boolean).join(" "),
            postal_code: s.zipCode ?? null,
            city: s.city ?? null,
            country: s.countryCode ?? "NL",
          },
          items: d.orderItems.map((i) => ({
            order_item_id: i.orderItemId,
            offer_id: i.offer?.offerId ?? null,
            reference: i.offer?.reference ?? null,
            ean: i.product?.ean ?? null,
            qty: i.quantity,
            unit_price_cents: Math.round(i.unitPrice * 100),
          })),
        });
      }
      return out;
    },
    async readOffer(ref) {
      if (!ref.offerId) return null;
      const res = await f(`${base}/retailer/offers/${encodeURIComponent(ref.offerId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${await auth()}`, Accept: V10 },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new BolApiError(`bol GET offer mislukt (HTTP ${res.status})`, isPermanentHttpStatus(res.status), res.status);
      const json = (await res.json()) as { stock?: { amount?: number }; pricing?: { bundlePrices?: { quantity: number; unitPrice: number }[] } };
      const unit = json.pricing?.bundlePrices?.find((b) => b.quantity === 1)?.unitPrice;
      return { stock: json.stock?.amount ?? null, priceCents: unit != null ? Math.round(unit * 100) : null };
    },
  };
}
