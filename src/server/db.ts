import { Pool, PoolClient, QueryResultRow } from "pg";

declare global { var __rsipPool: Pool | undefined; }

export function pool(): Pool {
  if (!global.__rsipPool) {
    global.__rsipPool = new Pool({ connectionString: process.env.DATABASE_URL || "postgres://rsip:rsip@localhost:5432/rsip", max: Number(process.env.PG_POOL_MAX || 10) });
  }
  return global.__rsipPool;
}

export type Db = Pool | PoolClient;

export async function q<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(sql, params as any[]);
  return r.rows;
}
export async function one<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(db, sql, params);
  return rows[0] ?? null;
}

/** Run fn in one transaction: a mapping change and its audit row commit together (Developer Guide 6.1). */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  let broken: Error | undefined;
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    // keep the original error even if the rollback fails; a connection whose rollback failed is discarded
    try { await c.query("ROLLBACK"); } catch (r: any) { broken = r; }
    throw e;
  } finally {
    c.release(broken);
  }
}
