import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { inject } from "vitest";
import { createPgDb } from "@/server/db/pg";
import type { Db } from "@/server/db/types";

export type TestDb = { pool: Pool; db: Db; name: string; url: string; close: () => Promise<void> };

/** Verse database (kopie van de gemigreerde template) per testbestand. */
export async function freshDb(): Promise<TestDb> {
  const port = inject("pgPort");
  const base = `postgres://postgres:postgres@127.0.0.1:${port}`;
  const name = `t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const admin = new Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query(`create database ${name} template tmpl`);
  await admin.end();
  const url = `${base}/${name}`;
  const pool = new Pool({ connectionString: url, max: 12 });
  const db = createPgDb(pool);
  return { pool, db, name, url, close: () => pool.end() };
}

export async function q<T = Record<string, unknown>>(pool: Pool, sql: string, params: unknown[] = []) {
  return (await pool.query(sql, params)).rows as T[];
}

export async function productId(pool: Pool, sku: string): Promise<string> {
  const rows = await q<{ id: string }>(pool, "select id from products where sku = $1", [sku]);
  if (!rows[0]) throw new Error(`Onbekende sku ${sku}`);
  return rows[0].id;
}

export async function componentOnHand(pool: Pool, code: string) {
  const rows = await q<{ on_hand: number; reserved: number; free: number }>(
    pool,
    "select on_hand, reserved, free from component_stock where code = $1",
    [code],
  );
  return rows[0];
}
