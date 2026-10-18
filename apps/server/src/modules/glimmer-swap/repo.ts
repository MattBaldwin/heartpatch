import { and, eq, gt, gte, lt, sql } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { mapMembers, resourceLedger, users } from '../../db/schema.js';

/** The ledger reason a swap writes; its Glimmer rows are the day's count. */
export const SWAP_REASON = 'post-swap';

/**
 * Storage for the Glimmer swap (#523). No table of its own (no migration):
 * the day's swaps are the account's `post-swap` Glimmer rows in
 * `resource_ledger`, which every swap writes in its own transaction.
 */
export interface GlimmerSwapRepo {
  transaction: <T>(fn: (repo: GlimmerSwapRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /**
   * Row-locks the account's `users` row (tech spec §7 step 4): one swap at a
   * time per account, on every patch, so the daily cap holds.
   */
  lockAccount: (userId: string) => Promise<void>;
  /** Glimmer the account got from swaps in `[from, to)`, on every patch it has joined. */
  swappedBetween: (userId: string, from: Date, to: Date) => Promise<number>;
}

export function createGlimmerSwapRepo(db: Executor): GlimmerSwapRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createGlimmerSwapRepo(tx), tx)),

    lockAccount: async (userId) => {
      await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    },

    // Through map_members, so the ledger's (map_id, user_id) index serves
    // each of the account's patches; left patches still count (rows are kept).
    swappedBetween: async (userId, from, to) => {
      const [row] = await db
        .select({ total: sql<string>`coalesce(sum(${resourceLedger.delta}), 0)` })
        .from(mapMembers)
        .innerJoin(
          resourceLedger,
          and(
            eq(resourceLedger.mapId, mapMembers.mapId),
            eq(resourceLedger.userId, mapMembers.userId),
          ),
        )
        .where(
          and(
            eq(mapMembers.userId, userId),
            eq(resourceLedger.reason, SWAP_REASON),
            eq(resourceLedger.itemId, 'glimmer'),
            gt(resourceLedger.delta, 0),
            gte(resourceLedger.createdAt, from),
            lt(resourceLedger.createdAt, to),
          ),
        );
      return Number(row?.total ?? 0);
    },
  };
}
