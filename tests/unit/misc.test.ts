import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePostalCode, splitStreet } from "@/server/services/address";
import { parseEuroToCents } from "@/lib/format";
import { isLiveStripeKey, createStripe } from "@/server/services/context";
import { createLiveBol } from "@/server/integrations/bol";

describe("adres splitsen", () => {
  it.each([
    ["Teststraat 12", "Teststraat", "12"],
    ["Teststraat 12A", "Teststraat", "12A"],
    ["Lange Nieuwstraat 5-bis", "Lange Nieuwstraat", "5-bis"],
    ["Plein 1940 3", "Plein 1940", "3"],
    ["Kerkstraat 7 hs", "Kerkstraat", "7 hs"],
  ])("%s", (line, street, nr) => {
    expect(splitStreet(line)).toMatchObject({ street, house_number: nr });
  });
  it("laat een adres zonder huisnummer leeg zodat het als adresprobleem zichtbaar wordt", () => {
    expect(splitStreet("Postbus")).toMatchObject({ street: "Postbus", house_number: null });
  });
  it("normaliseert NL-postcodes", () => {
    expect(normalizePostalCode("1234ab", "NL")).toBe("1234 AB");
    expect(normalizePostalCode("1000", "BE")).toBe("1000");
  });
});

describe("bedragen", () => {
  it("leest euro's", () => {
    expect(parseEuroToCents("14,95")).toBe(1495);
    expect(parseEuroToCents("€ 19.95")).toBe(1995);
    expect(parseEuroToCents("20")).toBe(2000);
    expect(parseEuroToCents("abc")).toBeNull();
  });
});

describe("veiligheidsgrenzen", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("weigert live Stripe-sleutels tot livegang expliciet is aangezet", () => {
    expect(isLiveStripeKey("sk_live_x")).toBe(true);
    expect(isLiveStripeKey("rk_live_x")).toBe(true);
    expect(isLiveStripeKey("sk_test_x")).toBe(false);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(createStripe("sk_live_abc", false)).toBeNull();
    spy.mockRestore();
    expect(createStripe("sk_test_abc", false)).not.toBeNull();
  });

  it("kan de lokale beheerbypass nooit activeren in productie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_DEV_BYPASS", "1");
    vi.stubEnv("DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:54329/timberonline");
    const { env } = await import("@/server/env");
    expect(env.adminDevBypass()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@db.supabase.co:5432/postgres");
    expect(env.adminDevBypass()).toBe(false);
  });
});

describe("bol Retailer API v10 (verzoekvorm)", () => {
  it("stuurt voorraad, prijs en verzending in het v10-formaat", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("https://login.bol.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 300 }), { status: 200 });
      return new Response(JSON.stringify({ processStatusId: "123" }), { status: 202 });
    }) as unknown as typeof fetch;
    const bol = createLiveBol({ clientId: "id", clientSecret: "secret", fetchImpl });
    expect(await bol.updateStock({ offerId: "abc", reference: null, ean: null }, 3)).toEqual({ status: "submitted", processId: "123" });
    await bol.updatePrice({ offerId: "abc", reference: null, ean: null }, 1995);
    await bol.confirmShipment({ orderItemIds: ["i1"], carrier: "postnl", trackingCode: "3S1" });
    const stock = calls[1];
    expect(stock.url).toBe("https://api.bol.com/retailer/offers/abc/stock");
    expect(JSON.parse(String(stock.init.body))).toEqual({ amount: 3, managedByRetailer: true });
    expect((stock.init.headers as Record<string, string>).Accept).toBe("application/vnd.retailer.v10+json");
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ pricing: { bundlePrices: [{ quantity: 1, unitPrice: 19.95 }] } });
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ orderItems: [{ orderItemId: "i1" }], transport: { transporterCode: "TNT", trackAndTrace: "3S1" } });
    await expect(bol.updateStock({ offerId: null, reference: "R", ean: null }, 1)).rejects.toThrow(/offerId ontbreekt/);
  });
});
