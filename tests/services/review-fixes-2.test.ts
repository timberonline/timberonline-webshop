/** Regressietests voor de bevindingen uit Codex-reviewronde 2. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testCtx } from "../helpers/ctx";
import { freshDb, productId, q, type TestDb } from "../helpers/db";
import { processBolQueue, reconcileBol } from "@/server/services/bol-sync";

let t: TestDb;
const ACTOR = "test:admin";
const P: Record<string, string> = {};

beforeAll(async () => {
  t = await freshDb();
  for (const sku of ["TO-SP2-IP15-PRV", "TO-SP2-IP15P-PRV", "TO-SP2-IP15PM-PRV", "TO-SP2-IP14-STD", "TO-BND-IP14-CS-SP1"]) P[sku] = await productId(t.pool, sku);
  for (const sku of ["TO-SP2-IP15-PRV", "TO-SP2-IP15P-PRV", "TO-SP2-IP15PM-PRV", "TO-SP2-IP14-STD"]) {
    await t.db.rpc("api_product_save", { actor: ACTOR, id: P[sku], bol_enabled: true, bol_offer_id: `r2-${sku}` });
  }
});
afterAll(async () => t.close());

const due = () => t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second'");

describe("Codex R2-1: claims per item", () => {
  it("heeft tijdens een verzoek nooit meer dan één item tegelijk geclaimd", async () => {
    await due();
    const { ctx, bol } = testCtx(t.db);
    const inFlight: number[] = [];
    const orig = bol.updateStock.bind(bol);
    bol.updateStock = async (ref, amount) => {
      inFlight.push(Number((await q<{ n: string }>(t.pool, "select count(*)::text n from bol_sync where status = 'in_flight'"))[0].n));
      return orig(ref, amount);
    };
    const res = await processBolQueue(ctx, { limit: 50 });
    expect(res.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...inFlight)).toBe(1);
  });
});

describe("Codex R2-2: ingediende verzoeken worden gecontroleerd, niet blind opnieuw ingediend", () => {
  it("geeft na een onderbroken controle en na een tijdelijke controlefout opnieuw 'check'", async () => {
    const id = P["TO-SP2-IP15-PRV"];
    await t.db.rpc("api_stock_correct", { actor: ACTOR, component_id: (await q<{ id: string }>(t.pool, "select id from components where code = 'C-SP-IP15-PRV'"))[0].id, mode: "delta", value: -2, reason: "test" });
    await due();
    type C = { items: { product_id: string; kind: string; token: string; action: string }[] };
    const first = (await t.db.rpc<C>("api_bol_sync_claim", { limit: 50 })).items.find((x) => x.product_id === id && x.kind === "stock")!;
    expect(first.action).toBe("push");
    await t.db.rpc("api_bol_sync_complete", { product_id: id, kind: "stock", token: first.token, result: "submitted", process_id: "proc-1" });
    await due();
    const check1 = (await t.db.rpc<C>("api_bol_sync_claim", { limit: 50 })).items.find((x) => x.product_id === id && x.kind === "stock")!;
    expect(check1.action).toBe("check");
    // worker valt uit tijdens de controle; claim verloopt
    await t.pool.query("update bol_sync set claimed_at = now() - interval '5 minutes', next_attempt_at = now() - interval '1 second' where product_id = $1 and kind = 'stock'", [id]);
    const check2 = (await t.db.rpc<C>("api_bol_sync_claim", { limit: 50 })).items.find((x) => x.product_id === id && x.kind === "stock")!;
    expect(check2.action).toBe("check");
    // tijdelijke fout bij opvragen processtatus: proces-ID blijft bewaard
    await t.db.rpc("api_bol_sync_complete", { product_id: id, kind: "stock", token: check2.token, result: "check_error", error: "ECONNRESET" });
    const [row] = await q<{ status: string; process_id: string }>(t.pool, "select status, process_id from bol_sync where product_id = $1 and kind = 'stock'", [id]);
    expect(row).toEqual({ status: "submitted", process_id: "proc-1" });
  });
});

describe("Codex R2-3: wijziging van de bundelsamenstelling herberekent bol-standen", () => {
  it("zet bol-artikelen die oude of nieuwe componenten delen opnieuw in de wachtrij", async () => {
    const set14 = P["TO-SP2-IP14-STD"];
    await t.pool.query("update bol_sync set status = 'synced', claim_token = null, process_id = null where product_id = $1", [set14]);
    const [before] = await q<{ v: string }>(t.pool, "select desired_version::text v from bol_sync where product_id = $1 and kind = 'stock'", [set14]);
    const comps = await q<{ id: string; code: string }>(t.pool, "select id, code from components where code in ('C-CS-IP14', 'C-SP-IP14-STD')");
    await t.db.rpc("api_product_save", {
      actor: ACTOR,
      id: P["TO-BND-IP14-CS-SP1"],
      components: comps.map((c) => ({ component_id: c.id, qty: c.code === "C-CS-IP14" ? 1 : 2 })),
    });
    const [after] = await q<{ v: string; status: string }>(t.pool, "select desired_version::text v, status from bol_sync where product_id = $1 and kind = 'stock'", [set14]);
    expect(BigInt(after.v)).toBeGreaterThan(BigInt(before.v));
    expect(after.status).toBe("pending");
  });
});

describe("Codex R2-4: reconciliatie gaat door als één aanbieding niet te lezen is", () => {
  it("registreert de andere verschillen en meldt de fout", async () => {
    const { ctx, bol } = testCtx(t.db);
    await t.pool.query("update bol_sync set status = 'synced', claim_token = null, process_id = null");
    bol.readOffer = async (ref) => {
      if (ref.offerId === "r2-TO-SP2-IP15P-PRV") throw new Error("HTTP 500");
      return { stock: 999, priceCents: 1 };
    };
    const r = await reconcileBol(ctx);
    expect(r.errors.map((e) => e.sku)).toEqual(["TO-SP2-IP15P-PRV"]);
    expect(r.differences).toBeGreaterThanOrEqual(6); // 3 leesbare aanbiedingen × voorraad + prijs
  });
});

describe("Codex R2-6: klaargezette mails blijven zichtbaar en worden opgepakt", () => {
  it("neemt oude 'pending' mee en toont vastgelopen mails in het overzicht", async () => {
    const r = await t.db.rpc<{ order_id: string }>("api_create_web_order", { lines: [{ product_id: P["TO-SP2-IP15PM-PRV"], qty: 1 }] });
    await t.db.rpc("api_mark_order_paid", { order_id: r.order_id, payment_intent_id: "pi_r26", customer: { email: "k@example.test", name: "K" } });
    await t.pool.query("alter table email_log disable trigger email_log_touch");
    await t.pool.query("update email_log set created_at = now() - interval '10 days', updated_at = now() - interval '10 days' where order_id = $1", [r.order_id]);
    await t.pool.query("alter table email_log enable trigger email_log_touch");
    const list = await t.db.rpc<{ order_id: string }[]>("api_email_retry_list", {});
    expect(list.map((x) => x.order_id)).toContain(r.order_id);
    const o = await t.db.rpc<{ email_failed: number }>("api_admin_overview", {});
    expect(o.email_failed).toBeGreaterThanOrEqual(1);
    // Codex R3: vanuit de melding vindbaar via het mailfilter, ook zonder 'aandacht'-vlag
    const orders = await t.db.rpc<{ id: string; mail_problem: boolean; needs_attention: boolean }[]>("api_admin_orders", { mail_problem: true });
    const hit = orders.find((x) => x.id === r.order_id);
    expect(hit).toMatchObject({ mail_problem: true, needs_attention: false });
  });
});
