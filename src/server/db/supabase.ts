import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DbError, type Db } from "./types";

export function createSupabaseDb(client: SupabaseClient): Db {
  return {
    async rpc<T>(fn: string, params: Record<string, unknown> = {}) {
      const { data, error } = await client.rpc(fn, { p: params });
      if (error) throw new DbError(error.message, fn);
      return data as T;
    },
  };
}

export function createServiceClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": "timberonline-server" } },
  });
}
