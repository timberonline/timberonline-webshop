import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, productId, q, type TestDb } from "../helpers/db";
import { testCtx } from "../helpers/ctx";
import { isPermanentHttpStatus } from "@/server/integrations/bol";
import { processBolQueue, reconcileBol } from "@/server/services/bol-sync";

let t: TestDb;
const ACTOR = "test:admin";

async function row(id: string) {
  const [r] = await q<{ status: string; attempts: number; last_error: string | null }>(
    t.pool,
    "select status, attempts, last_error from bol_sync where product_id = $1 and kind = 'stock'",
    [id],
  );
  return r;
}

beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

describe("bol-foutclassificatie", () => {
  it("onderscheidt definitieve en herstelbare HTTP-statussen", () => {
    expect([400, 403, 404, 422].map(isPermanentHttpStatus)).toEqual([true, true, true, true]);
    expect([401, 408, 409, 429, 500, 503].map(isPermanentHttpStatus)).toEqual([false, false, false, false, false, false]);
  });

  it("zet een definitieve fout direct op mislukt en een tijdelijke fout opnieuw in de wachtrij", async () => {
    const a = await productId(t.pool, "TO-SP2-IP11PM-PRV");
    const b = await productId(t.pool, "TO-SP2-IP12-PRV");
    for (const id of [a, b]) await t.db.rpc("api_product_save", { actor: ACTOR, id, bol_enabled: true, bol_offer_id: `o-${id.slice(0, 6)}` });
    // alleen de stock-items van a en b: prijsupdates eerst verwerken zonder fouten
    const { ctx, bol } = testCtx(t.db);
    await t.pool.query("update bol_sync set next_attempt_at = now() + interval '1 hour' where kind = 'stock'");
    await t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second' where kind = 'price'");
    await processBolQueue(ctx);
    await t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second' where kind = 'stock' and product_id = $1", [a]);
    bol.faults.permanentNext = 1;
    await processBolQueue(ctx, { limit: 1 });
    expect(await row(a)).toMatchObject({ status: "failed", attempts: 1 });
    expect((await row(a)).last_error).toMatch(/Definitieve fout.*422/);

    await t.pool.query("update bol_sync set next_attempt_at = now() - interval '1 second' where kind = 'stock' and product_id = $1", [b]);
    bol.faults.failNext = 1;
    await processBolQueue(ctx, { limit: 1 });
    expect(await row(b)).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("meldt een ontbrekend bol-aanbod bij reconciliatie zonder het eindeloos opnieuw in te plannen", async () => {
    const c = await productId(t.pool, "TO-SP2-IP12PM-STD");
    await t.db.rpc("api_product_save", { actor: ACTOR, id: c, bol_enabled: true, bol_offer_id: "o-niet-in-sim" });
    const { ctx } = testCtx(t.db);
    // aanbod nooit gepusht → bestaat niet in de gesimuleerde bol-omgeving
    await t.pool.query("update bol_sync set next_attempt_at = now() + interval '1 hour', status = 'synced' where product_id = $1", [c]);
    const res = await reconcileBol(ctx);
    expect(res.missing).toBeGreaterThanOrEqual(2);
    expect((await row(c)).status).toBe("failed");
    expect((await row(c)).last_error).toMatch(/niet gevonden/);
  });
});
