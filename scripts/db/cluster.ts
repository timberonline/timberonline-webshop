import EmbeddedPostgres from "embedded-postgres";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { applyMigrations } from "./migrate";

export type Cluster = { pg: EmbeddedPostgres; port: number; url: (db: string) => string };

export async function startCluster(dataDir: string, port: number, persistent: boolean): Promise<Cluster> {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent,
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  return { pg, port, url: (db: string) => `postgres://postgres:postgres@127.0.0.1:${port}/${db}` };
}

export async function prepareDatabase(cluster: Cluster, db: string) {
  const admin = new Client({ connectionString: cluster.url("postgres") });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [db]);
  if (exists.rowCount === 0) await admin.query(`create database "${db}"`);
  await admin.end();
  const client = new Client({ connectionString: cluster.url(db) });
  await client.connect();
  await client.query(readFileSync(path.join(process.cwd(), "supabase", "local", "bootstrap.sql"), "utf8"));
  const done = await applyMigrations(client);
  await client.end();
  return done;
}
