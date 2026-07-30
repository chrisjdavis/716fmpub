import type { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * Minimal `pg.Pool` surface used by dashboard analytics and canonicalization tests.
 */
export function pgliteAsPool(pglite: PGlite): Pick<Pool, "query" | "connect"> {
  const query = async <R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> => {
    const r = await pglite.query<R>(text, params as never[] | undefined);
    return r as QueryResult<R>;
  };
  const connect = async (): Promise<PoolClient> => {
    const client = {
      query,
      release: () => {},
    };
    return client as unknown as PoolClient;
  };
  return { query, connect } as Pick<Pool, "query" | "connect">;
}
