import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, q, type TestDb } from "../helpers/db";

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

describe("openingscatalogus", () => {
  it("bevat 341 fysieke stuks: 315 protectors en 26 hoesjes", async () => {
    const rows = await q<{ kind: string; total: string }>(t.pool, "select kind, sum(on_hand)::text total from components group by kind");
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, Number(r.total)]));
    expect(byKind.protector).toBe(315);
    expect(byKind.case).toBe(26);
  });

  it("legt de openingstelling vast als voorraadmutatie", async () => {
    const [r] = await q<{ total: string }>(t.pool, "select sum(delta)::text total from stock_movements where reason = 'opening'");
    expect(Number(r.total)).toBe(341);
  });

  it("heeft één SKU voor iPhone 13 en 13 Pro (normaal) met 27 stuks", async () => {
    const rows = await q<{ device_slug: string; confirmed: boolean }>(
      t.pool,
      `select pd.device_slug, pd.confirmed from product_devices pd join products p on p.id = pd.product_id
       where p.sku = 'TO-SP2-IP13-STD' order by 1`,
    );
    expect(rows).toEqual([
      { device_slug: "iphone-13", confirmed: true },
      { device_slug: "iphone-13-pro", confirmed: true },
    ]);
    const [c] = await q<{ on_hand: number }>(t.pool, "select on_hand from components where code = 'C-SP-IP13-STD'");
    expect(c.on_hand).toBe(27);
  });

  it("koppelt EAN 9509916568396 aan het iPhone 13 Pro-hoesje met bol-titelcorrectie", async () => {
    const [p] = await q<{ title: string; bol_title_fix_required: boolean; bol_reference: string; bol_offer_id: string | null }>(
      t.pool,
      "select title, bol_title_fix_required, bol_reference, bol_offer_id from products where ean = '9509916568396'",
    );
    expect(p.title).toContain("iPhone 13 Pro");
    expect(p.bol_title_fix_required).toBe(true);
    expect(p.bol_reference).toBe("BOLMC13");
    expect(p.bol_offer_id).toBeNull();
  });

  it("houdt twijfel over iPhone 14 Pro-compatibiliteit als concept (niet zichtbaar in de shop)", async () => {
    const cat = await t.db.rpc<{ products: { sku: string; devices: { slug: string }[] }[] }>("api_catalog");
    const p = cat.products.find((x) => x.sku === "TO-SP2-IP14-STD")!;
    expect(p.devices.map((d) => d.slug)).toEqual(["iphone-14"]);
  });

  it("stelt voorlopige prijzen in voor beide kanalen", async () => {
    const rows = await q<{ sku: string; web_price_cents: number; bol_price_cents: number }>(
      t.pool,
      "select sku, web_price_cents, bol_price_cents from products where kind <> 'bundle' and status = 'active'",
    );
    for (const r of rows) {
      const expected = r.sku === "TO-SP2-IP15PL-PRV" ? 2495 : 1995;
      expect(r.web_price_cents, r.sku).toBe(expected);
      expect(r.bol_price_cents, r.sku).toBe(expected);
    }
  });

  it("activeert geen bol-aanbiedingen bij de start", async () => {
    const [r] = await q<{ n: string }>(t.pool, "select count(*)::text n from products where bol_enabled");
    expect(Number(r.n)).toBe(0);
  });

  it("toont alleen actieve artikelen met beschikbare eenheden in de catalogus", async () => {
    const cat = await t.db.rpc<{ products: { sku: string; available_units: number }[] }>("api_catalog");
    const skus = cat.products.map((p) => p.sku);
    expect(skus).not.toContain("TO-SP2-IP11-STD"); // concept
    const ip12pm = cat.products.find((p) => p.sku === "TO-SP2-IP12PM-PRV")!;
    expect(ip12pm.available_units).toBe(2); // 5 stuks = 2 tweepacks
  });

  it("is idempotent: de seed opnieuw draaien verandert niets", async () => {
    const before = await q(t.pool, "select code, on_hand from components order by code");
    const { readFileSync } = await import("node:fs");
    await t.pool.query(readFileSync("supabase/migrations/20261118120300_catalog_seed.sql", "utf8"));
    const after = await q(t.pool, "select code, on_hand from components order by code");
    expect(after).toEqual(before);
    const [m] = await q<{ n: string }>(t.pool, "select count(*)::text n from stock_movements where reason = 'opening'");
    expect(Number(m.n)).toBe(19);
  });
});

describe("rechten", () => {
  it("weigert anon en authenticated toegang tot tabellen en functies", async () => {
    const client = await t.pool.connect();
    try {
      for (const role of ["anon", "authenticated"]) {
        await client.query(`set role ${role}`);
        await expect(client.query("select * from orders limit 1")).rejects.toThrow(/permission denied/);
        await expect(client.query("select * from components limit 1")).rejects.toThrow(/permission denied/);
        await expect(client.query("select public.api_catalog('{}')")).rejects.toThrow(/permission denied/);
        await expect(client.query("select public.api_mark_order_paid('{}')")).rejects.toThrow(/permission denied/);
        await client.query("reset role");
      }
    } finally {
      await client.query("reset role");
      client.release();
    }
  });

  it("staat service_role toe", async () => {
    const client = await t.pool.connect();
    try {
      await client.query("set role service_role");
      const r = await client.query("select jsonb_typeof(public.api_catalog('{}')) t");
      expect(r.rows[0].t).toBe("object");
    } finally {
      await client.query("reset role");
      client.release();
    }
  });

  it("heeft RLS aan op alle tabellen", async () => {
    const rows = await q<{ relname: string }>(
      t.pool,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });
});
