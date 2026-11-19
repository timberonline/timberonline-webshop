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
  "do $guard$ begin if exists (select 1 from supabase_migrations.schema_migrations) then raise exception 'Er zijn al migraties geregistreerd; dit script is alleen voor een leeg project'; end if; end $guard$;",
];
for (const m of listMigrations()) {
  out.push(`\n-- ===== ${m.file} =====\n${m.sql}`);
  out.push(`insert into supabase_migrations.schema_migrations (version, name, statements) values ('${m.version}', '${m.name}', array[]::text[]);`);
}
out.push("commit;");
process.stdout.write(out.join("\n") + "\n");
