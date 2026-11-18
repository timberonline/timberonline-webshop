import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componentOnHand, freshDb, q, type TestDb } from "../helpers/db";
import { parsePricePrompt, parseWithOpenAI, type AdminProduct } from "@/server/ai/price-assistant";

let t: TestDb;
let products: AdminProduct[];
const ACTOR = "test:admin";

beforeAll(async () => {
  t = await freshDb();
  products = await t.db.rpc<AdminProduct[]>("api_admin_products", {});
});
afterAll(async () => t.close());

describe("AI-prijsassistent (testimplementatie)", () => {
  it("toont vóór bevestiging de concrete SKU's, kanaal en huidige en nieuwe prijs", () => {
    const r = parsePricePrompt("Zet de webshopprijs van alle iPhone 15-privacysets op €14,95", products);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.sku).sort()).toEqual(["TO-SP2-IP15-PRV", "TO-SP2-IP15P-PRV", "TO-SP2-IP15PL-PRV", "TO-SP2-IP15PM-PRV"]);
    expect(r.items.every((i) => i.channel === "web" && i.new_cents === 1495)).toBe(true);
    expect(r.items.find((i) => i.sku === "TO-SP2-IP15PL-PRV")?.old_cents).toBe(2495);
    expect(r.interpretation.join(" ")).toMatch(/iPhone 15-serie/);
  });

  it("leest een specifiek toestel zonder ‘alle’ als alleen dat toestel", () => {
    const r = parsePricePrompt("Zet de bol-prijs van de iPhone 15 Pro privacy screenprotector op 17,50", products);
    expect(r.ok && r.items.map((i) => [i.sku, i.channel, i.new_cents])).toEqual([["TO-SP2-IP15P-PRV", "bol", 1750]]);
  });

  it("ondersteunt procentuele wijzigingen op beide kanalen en slaat bundels over op bol", () => {
    const r = parsePricePrompt("Verlaag alle iPhone 14 artikelen met 10% op beide kanalen", products);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.some((i) => i.sku.startsWith("TO-BND") && i.channel === "bol")).toBe(false);
    expect(r.items.some((i) => i.sku.startsWith("TO-BND") && i.channel === "web")).toBe(true);
    expect(r.items.find((i) => i.sku === "TO-SP2-IP14-STD" && i.channel === "web")?.new_cents).toBe(1796);
  });

  it("accepteert een opdracht met alleen SKU's", () => {
    const r = parsePricePrompt("Zet de webshopprijs van TO-SP2-IP15-PRV en TO-SP2-IP15P-PRV op 19,95", products);
    expect(r.ok && r.items.map((i) => i.sku).sort()).toEqual(["TO-SP2-IP15-PRV", "TO-SP2-IP15P-PRV"]);
  });

  it("vraagt om verduidelijking als kanaal of prijs ontbreekt", () => {
    expect(parsePricePrompt("Zet alle iPhone 15-privacysets op €14,95", products)).toMatchObject({ ok: false, error: expect.stringMatching(/kanaal/) });
    expect(parsePricePrompt("Webshopprijs iPhone 15 privacy aanpassen", products)).toMatchObject({ ok: false });
  });

  it("past alleen bevestigde wijzigingen toe via dezelfde controle als handmatig beheer en laat voorraad ongemoeid", async () => {
    const before = await componentOnHand(t.pool, "C-SP-IP15-PRV");
    const r = parsePricePrompt("Zet de webshopprijs van alle iPhone 15-privacysets op €14,95", products);
    if (!r.ok) throw new Error(r.error);
    const prop = await t.db.rpc<{ id: string; items: { product_id: string; channel: string }[] }>("api_ai_proposal_create", { actor: ACTOR, prompt: "x", items: r.items });
    const keep = prop.items.filter((i) => !i.product_id.startsWith(products.find((p) => p.sku === "TO-SP2-IP15PL-PRV")!.id)).map((i) => `${i.product_id}:${i.channel}`);
    const plus = products.find((p) => p.sku === "TO-SP2-IP15PL-PRV")!;
    const applied = await t.db.rpc<{ ok: boolean; result: { sku: string; applied: boolean }[] }>("api_ai_proposal_apply", { actor: ACTOR, id: prop.id, selected: keep });
    expect(applied.result.map((x) => x.sku).sort()).toEqual(["TO-SP2-IP15-PRV", "TO-SP2-IP15P-PRV", "TO-SP2-IP15PM-PRV"]);
    const [plusNow] = await q<{ web_price_cents: number }>(t.pool, "select web_price_cents from products where id = $1", [plus.id]);
    expect(plusNow.web_price_cents).toBe(2495);
    const audits = await q<{ actor: string }>(t.pool, "select actor from audit_log where action = 'price_change' and after->>'source' = 'ai'");
    expect(audits).toHaveLength(3);
    expect(await componentOnHand(t.pool, "C-SP-IP15-PRV")).toEqual(before);
    const again = await t.db.rpc<{ ok: boolean; error: string }>("api_ai_proposal_apply", { actor: ACTOR, id: prop.id });
    expect(again.error).toBe("already_decided");
  });

  it("past niet blind toe als de prijs sinds het voorstel is gewijzigd", async () => {
    const fresh = await t.db.rpc<AdminProduct[]>("api_admin_products", {});
    const r = parsePricePrompt("Zet de webshopprijs van de iPhone 12 privacy screenprotector op €12,00", fresh);
    if (!r.ok) throw new Error(r.error);
    const prop = await t.db.rpc<{ id: string }>("api_ai_proposal_create", { actor: ACTOR, prompt: "x", items: r.items });
    await t.db.rpc("api_set_price", { actor: ACTOR, product_id: r.items[0].product_id, channel: "web", price_cents: 1895 });
    const res = await t.db.rpc<{ result: { applied: boolean; error?: string }[] }>("api_ai_proposal_apply", { actor: ACTOR, id: prop.id });
    expect(res.result[0]).toMatchObject({ applied: false, error: expect.stringMatching(/gewijzigd/) });
  });

  it("valideert het antwoord van een externe AI-provider tegen de catalogus", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ sku: "TO-SP2-IP15-PRV", channel: "web", new_cents: 1495 }, { sku: "VERZONNEN", channel: "web", new_cents: 1 }, { sku: "TO-BND-IP14-CS-SP2", channel: "bol", new_cents: 100 }] }) } }] }), { status: 200 })) as unknown as typeof fetch;
    const r = await parseWithOpenAI("x", products, { apiKey: "test", model: "test", fetchImpl });
    expect(r.ok && r.items.map((i) => i.sku)).toEqual(["TO-SP2-IP15-PRV"]);
  });
});
