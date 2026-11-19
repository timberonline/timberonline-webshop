/**
 * Bundelt alle migraties in één transactie voor de SQL-editor van Supabase (eerste inrichting van een leeg project,
 * zonder Supabase-CLI-login). Registreert elke versie in supabase_migrations.schema_migrations, zodat
 * `supabase db push` daarna alleen nieuwe migraties toepast. Weigert te draaien als er al migraties geregistreerd zijn.
 *
 * Gebruik: npx tsx scripts/db/bundle-migrations.ts > /tmp/alle-migraties.sql   (bestand niet committen)
 */
import { listMigrations } from "./migrate";

const out = [
  "-- Timber Online 2.0 · alle migraties in één transactie (Supabase SQL-editor). Gegenereerd uit supabase/migrations.",
  "begin;",
  "create schema if not exists supabase_migrations;",
  "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);",
  "do $guard$ begin if exists (select 1 from supabase_migrations.schema_migrations) or to_regclass('public.products') is not null or to_regclass('public.components') is not null then raise exception 'Project is niet leeg (migraties of tabellen aanwezig); dit script is alleen voor de eerste inrichting'; end if; end $guard$;",
];
for (const m of listMigrations()) {
  // alleen eigen, voorspelbare bestandsnamen: geen aanhalingstekens, regeleinden of andere tekens in de SQL
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(m.file)) throw new Error(`Ongeldige migratienaam: ${JSON.stringify(m.file)}`);
  out.push(`\n-- ===== ${m.file} =====\n${m.sql}`);
  out.push(`insert into supabase_migrations.schema_migrations (version, name, statements) values ('${m.version}', '${m.name}', array[]::text[]);`);
}
out.push("commit;");
process.stdout.write(out.join("\n") + "\n");
