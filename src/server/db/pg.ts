import { Pool } from "pg";
import { DbError, type Db } from "./types";

const FN_NAME = /^api_[a-z0-9_]+$/;

export function createPgDb(pool: Pool): Db {
  return {
    async rpc<T>(fn: string, params: Record<string, unknown> = {}) {
      if (!FN_NAME.test(fn)) throw new DbError("Ongeldige functienaam", fn);
      try {
        const res = await pool.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(params)]);
        return res.rows[0]?.r as T;
      } catch (e) {
        throw new DbError((e as Error).message, fn);
      }
    },
  };
}
