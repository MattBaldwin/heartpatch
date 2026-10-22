import type { HeartCoinSource } from '@heartpatch/shared';
import { and, eq, sql, sum } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { heartCoinBalances, heartCoinLedger } from '../../db/schema.js';

/** One ledger row on its way in. */
export interface NewHeartCoinChange {
  mapId: string;
  userId: string;
  source: HeartCoinSource;
  refId: string;
  /** Positive to earn, negative to spend. */
  amount: number;
  /** The patch's local date (`maps.time_zone`). */
  day: string;
  at: Date;
}

/**
 * Heart Coin storage (#601): the ledger (`heart_coin_ledger`) and each
 * player's cached balance on each patch (`heart_coin_balances`). Plain
 * queries; the service decides the rules. Lock order (tech spec §7 step
 * 12b): the balance row comes after the account's `coin_balances` row and
 * before `maps`.
 */
export interface HeartCoinsRepo {
  transaction: <T>(fn: (repo: HeartCoinsRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The player's balance on the patch (0 before their first coin there). */
  balance: (mapId: string, userId: string) => Promise<number>;
  /**
   * Row-locks the player's balance on the patch until commit, making the
   * row first if it's missing. Every credit and spend takes it, so they run
   * one at a time per player per patch.
   */
  lockBalance: (mapId: string, userId: string) => Promise<number>;
  /** True if this source event already changed a balance. */
  hasChange: (source: HeartCoinSource, refId: string) => Promise<boolean>;
  /** What the player earned on the patch on `day`, by source (sources with none left out). */
  earnedOn: (
    mapId: string,
    userId: string,
    day: string,
  ) => Promise<Partial<Record<HeartCoinSource, number>>>;
  /** Appends the ledger row and moves the (locked) balance by its amount; the new balance. */
  apply: (change: NewHeartCoinChange) => Promise<number>;
}

export function createHeartCoinsRepo(db: Executor): HeartCoinsRepo {
  const mine = (mapId: string, userId: string) =>
    and(eq(heartCoinBalances.mapId, mapId), eq(heartCoinBalances.userId, userId));
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createHeartCoinsRepo(tx), tx)),

    balance: async (mapId, userId) => {
      const [row] = await db
        .select({ balance: heartCoinBalances.balance })
        .from(heartCoinBalances)
        .where(mine(mapId, userId));
      return row?.balance ?? 0;
    },

    lockBalance: async (mapId, userId) => {
      // A first credit makes the row; two at once both get here, and the
      // second waits on the first's insert, then finds the row.
      await db
        .insert(heartCoinBalances)
        .values({ mapId, userId, balance: 0 })
        .onConflictDoNothing();
      const [row] = await db
        .select({ balance: heartCoinBalances.balance })
        .from(heartCoinBalances)
        .where(mine(mapId, userId))
        .for('no key update');
      if (!row) throw new Error(`lockBalance: no Heart Coin row for ${userId} on ${mapId}`);
      return row.balance;
    },

    hasChange: async (source, refId) => {
      const [row] = await db
        .select({ id: heartCoinLedger.id })
        .from(heartCoinLedger)
        .where(and(eq(heartCoinLedger.source, source), eq(heartCoinLedger.refId, refId)));
      return row !== undefined;
    },

    earnedOn: async (mapId, userId, day) => {
      const rows = await db
        .select({
          source: heartCoinLedger.source,
          total: sum(heartCoinLedger.amount).mapWith(Number),
        })
        .from(heartCoinLedger)
        .where(
          and(
            eq(heartCoinLedger.mapId, mapId),
            eq(heartCoinLedger.userId, userId),
            eq(heartCoinLedger.day, day),
          ),
        )
        .groupBy(heartCoinLedger.source);
      return Object.fromEntries(rows.map((r) => [r.source, r.total]));
    },

    apply: async (change) => {
      await db.insert(heartCoinLedger).values({
        mapId: change.mapId,
        userId: change.userId,
        source: change.source,
        refId: change.refId,
        amount: change.amount,
        day: change.day,
        createdAt: change.at,
      });
      const [row] = await db
        .update(heartCoinBalances)
        .set({
          balance: sql`${heartCoinBalances.balance} + ${change.amount}`,
          updatedAt: change.at,
        })
        .where(mine(change.mapId, change.userId))
        .returning({ balance: heartCoinBalances.balance });
      if (!row) throw new Error(`apply: no Heart Coin row for ${change.userId} on ${change.mapId}`);
      return row.balance;
    },
  };
}
