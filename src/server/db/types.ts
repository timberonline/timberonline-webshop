/** Alle databasetoegang loopt via domeinfuncties: api_*(p jsonb) returns jsonb. */
export interface Db {
  rpc<T = unknown>(fn: `api_${string}`, params?: Record<string, unknown>): Promise<T>;
}

export class DbError extends Error {
  constructor(
    message: string,
    public readonly fn: string,
  ) {
    super(message);
    this.name = "DbError";
  }
}
