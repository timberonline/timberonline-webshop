import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({
      file,
      version: file.slice(0, 14),
      name: file.slice(15, -4),
      sql: readFileSync(path.join(dir, file), "utf8"),
    }));
}

/** Past migraties toe en registreert ze in dezelfde tabel als de Supabase CLI. */
export async function applyMigrations(client: Client, dir = MIGRATIONS_DIR) {
  await client.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  const applied = new Set(
    (await client.query<{ version: string }>("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version),
  );
  const done: string[] = [];
  for (const m of listMigrations(dir)) {
    if (applied.has(m.version)) continue;
    await client.query("begin");
    try {
      await client.query(m.sql);
      await client.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)", [
        m.version,
        m.name,
        [m.sql],
      ]);
      await client.query("commit");
      done.push(m.file);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`Migratie ${m.file} mislukt: ${(e as Error).message}`);
    }
  }
  return done;
}
