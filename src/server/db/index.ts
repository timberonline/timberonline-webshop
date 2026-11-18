import "server-only";
import { Pool } from "pg";
import { env } from "../env";
import { createPgDb } from "./pg";
import { createServiceClient, createSupabaseDb } from "./supabase";
import type { Db } from "./types";

let db: Db | undefined;

export function getDb(): Db {
  if (db) return db;
  if (env.dataDriver() === "pg") {
    const url = env.databaseUrl();
    if (!url) throw new Error("DATABASE_URL ontbreekt");
    db = createPgDb(new Pool({ connectionString: url, max: 5 }));
  } else {
    const url = env.supabaseUrl();
    const key = env.supabaseServiceKey();
    if (!url || !key) throw new Error("Supabase-configuratie ontbreekt (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    db = createSupabaseDb(createServiceClient(url, key));
  }
  return db;
}

export type { Db };
