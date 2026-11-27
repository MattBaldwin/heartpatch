import type { AdventResult } from '@heartpatch/shared';
import { and, between, eq } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { adventClaims } from '../../db/schema.js';

/** An opened advent day, as the calendar shows it. */
export interface AdventClaimSummary {
  day: string;
  items: AdventResult;
  catchUp: boolean;
  claimedOn: string;
}

export interface NewAdventClaim {
  id: string;
  userId: string;
  day: string;
  mapId: string;
  seed: string;
  result: AdventResult;
  catchUp: boolean;
  claimedOn: string;
  claimedAt: Date;
}

/**
 * `advent_claims` (#37 1c): one row per Keeper per advent day at account
 * level. Every read is by user (the `(user_id, day)` unique key covers it),
 * never by patch, so `map_id` needs no index.
 */
export interface AdventRepo {
  /** Runs `fn` in one transaction, with a repo that can also append events. */
  transaction: <T>(fn: (repo: AdventTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The Keeper's opened days between `from` and `to` (inclusive), any patch. A plain read. */
  claims: (userId: string, from: string, to: string) => Promise<AdventClaimSummary[]>;
  /** The Keeper has opened `day`'s present, from any patch. A plain read. */
  claimed: (userId: string, day: string) => Promise<boolean>;
  /**
   * Writes the claim. The `(user_id, day)` key and the one-catch-up-a-day
   * index refuse a second one (a race between two patches): the caller's
   * transaction then rolls back whole, bag included.
   */
  insert: (claim: NewAdventClaim) => Promise<void>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface AdventTxRepo extends AdventRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

function createAdventTxRepo(tx: Transaction): AdventTxRepo {
  return { ...createAdventRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

export function createAdventRepo(db: Executor): AdventRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createAdventTxRepo(tx), tx)),

    claims: async (userId, from, to) =>
      db
        .select({
          day: adventClaims.day,
          items: adventClaims.result,
          catchUp: adventClaims.catchUp,
          claimedOn: adventClaims.claimedOn,
        })
        .from(adventClaims)
        .where(and(eq(adventClaims.userId, userId), between(adventClaims.day, from, to)))
        .orderBy(adventClaims.day),

    claimed: async (userId, day) => {
      const [row] = await db
        .select({ id: adventClaims.id })
        .from(adventClaims)
        .where(and(eq(adventClaims.userId, userId), eq(adventClaims.day, day)));
      return row !== undefined;
    },

    insert: async (claim) => {
      await db.insert(adventClaims).values(claim);
    },
  };
}
