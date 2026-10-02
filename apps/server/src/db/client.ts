import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { ReadinessCheck } from '../modules/health/service.js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;
/** The handle passed to `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/**
 * What repo factories take: the pool, or a transaction so several repos'
 * writes commit together (`createMapsRepo(tx)` next to `createAuthRepo(tx)`).
 */
export type Executor = Database | Transaction;

/**
 * Runs `fn` in one transaction: everything it writes commits together or not
 * at all. Build the repos it needs from `tx` inside `fn`. Called with a
 * transaction, it nests as a savepoint.
 */
export function withTransaction<T>(db: Executor, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export interface DbClient {
  db: Database;
  /** Runs `SELECT 1`; rejects when Postgres is unreachable. */
  ping: () => Promise<void>;
  /** Closes the pool, letting in-flight queries finish. */
  close: () => Promise<void>;
}

export interface DbClientOptions {
  /** Pool size. */
  max?: number;
  /** Swallow server NOTICEs (migrations emit "already exists" notices). */
  quiet?: boolean;
}

export function createDbClient(url: string, options: DbClientOptions = {}): DbClient {
  const sql = postgres(url, {
    max: options.max ?? 10, // TUNE: one Node process for a handful of families (tech spec §7)
    connect_timeout: 5, // TUNE: seconds; keeps /ready from hanging on an unreachable DB
    ...(options.quiet ? { onnotice: () => undefined } : {}),
  });
  return {
    db: drizzle(sql, { schema }),
    ping: async () => {
      await sql`select 1`;
    },
    close: () => sql.end({ timeout: 5 }), // TUNE: seconds to wait for in-flight queries
  };
}

/** The `db` check reported by `GET /api/v1/ready`. */
export function dbReadinessCheck(client: Pick<DbClient, 'ping'>): ReadinessCheck {
  return { name: 'db', check: client.ping };
}
