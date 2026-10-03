import type { CoinSource } from '@heartpatch/shared';
import { and, eq, sql, sum } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { coinBalances, coinLedger, users } from '../../db/schema.js';

/** One ledger row on its way in. */
export interface NewCoinChange {
  userId: string;
  source: CoinSource;
  refId: string;
  /** Positive to earn, negative to spend. */
  amount: number;
  mapId: string | null;
  /** The account's local date (`users.time_zone`). */
  day: string;
  at: Date;
}

/**
 * Patch Coin storage (#45): the ledger (`coin_ledger`) and each account's
 * cached balance (`coin_balances`). Plain queries; the service decides the
 * rules. Lock order (tech spec §7): the balance row comes after squishies,
 * inventory and `species_seen`, and before `maps`.
 */
export interface CoinsRepo {
  transaction: <T>(fn: (repo: CoinsRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The account's balance (0 before its first coin). */
  balance: (userId: string) => Promise<number>;
  /**
   * Row-locks the account's balance until commit, making the row first if
   * it's missing. Every credit and purchase takes it, so they run one at a
   * time per account.
   */
  lockBalance: (userId: string) => Promise<number>;
  /** The account's IANA time zone, or null if there's no such user. */
  timeZoneOf: (userId: string) => Promise<string | null>;
  /** True if this source event already changed a balance. */
  hasChange: (source: CoinSource, refId: string) => Promise<boolean>;
  /** What the account earned from `source` on `day`. */
  earnedOn: (userId: string, source: CoinSource, day: string) => Promise<number>;
  /** Appends the ledger row and moves the (locked) balance by its amount; the new balance. */
  apply: (change: NewCoinChange) => Promise<number>;
}

export function createCoinsRepo(db: Executor): CoinsRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createCoinsRepo(tx), tx)),

    balance: async (userId) => {
      const [row] = await db
        .select({ balance: coinBalances.balance })
        .from(coinBalances)
        .where(eq(coinBalances.userId, userId));
      return row?.balance ?? 0;
    },

    lockBalance: async (userId) => {
      // A first credit makes the row; two at once both get here, and the
      // second waits on the first's insert, then finds the row.
      await db.insert(coinBalances).values({ userId, balance: 0 }).onConflictDoNothing();
      const [row] = await db
        .select({ balance: coinBalances.balance })
        .from(coinBalances)
        .where(eq(coinBalances.userId, userId))
        .for('no key update');
      if (!row) throw new Error(`lockBalance: no balance row for ${userId}`);
      return row.balance;
    },

    timeZoneOf: async (userId) => {
      const [row] = await db
        .select({ timeZone: users.timeZone })
        .from(users)
        .where(eq(users.id, userId));
      return row?.timeZone ?? null;
    },

    hasChange: async (source, refId) => {
      const [row] = await db
        .select({ id: coinLedger.id })
        .from(coinLedger)
        .where(and(eq(coinLedger.source, source), eq(coinLedger.refId, refId)));
      return row !== undefined;
    },

    earnedOn: async (userId, source, day) => {
      const [row] = await db
        .select({ total: sum(coinLedger.amount).mapWith(Number) })
        .from(coinLedger)
        .where(
          and(
            eq(coinLedger.userId, userId),
            eq(coinLedger.day, day),
            eq(coinLedger.source, source),
          ),
        );
      return row?.total ?? 0;
    },

    apply: async (change) => {
      await db.insert(coinLedger).values({
        userId: change.userId,
        source: change.source,
        refId: change.refId,
        amount: change.amount,
        mapId: change.mapId,
        day: change.day,
        createdAt: change.at,
      });
      const [row] = await db
        .update(coinBalances)
        .set({ balance: sql`${coinBalances.balance} + ${change.amount}`, updatedAt: change.at })
        .where(eq(coinBalances.userId, change.userId))
        .returning({ balance: coinBalances.balance });
      if (!row) throw new Error(`apply: no balance row for ${change.userId}`);
      return row.balance;
    },
  };
}
