import type { PostShopItemId } from '@heartpatch/shared';
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { postPurchases } from '../../db/schema.js';

/** The item reason a pack or crate writes on the bag rows it grants. */
export const SHOP_REASON = 'shop';

/** A purchase's patch day and whether it's a lure still waiting. */
export interface PurchaseRow {
  id: string;
  itemId: string;
  day: string;
  consumedAt: Date | null;
}

export interface NewPurchase {
  id: string;
  mapId: string;
  userId: string;
  itemId: PostShopItemId;
  price: number;
  day: string;
  createdAt: Date;
}

/**
 * Storage for the trading post's Shop (#729): `post_purchases` rows,
 * inserted with their `shop` Heart Coin ledger row and never locked, except
 * a Rare Lure's consume (tech spec §7 step 5d).
 */
export interface PostShopRepo {
  transaction: <T>(fn: (repo: PostShopTxRepo, tx: Transaction) => Promise<T>) => Promise<T>;
  /** My purchases on a patch from `since` (a patch day) on, plus any lure still held, oldest first. */
  recent: (mapId: string, userId: string, since: string) => Promise<PurchaseRow[]>;
  insert: (row: NewPurchase) => Promise<void>;
}

export interface PostShopTxRepo extends PostShopRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

export function createPostShopRepo(db: Executor): PostShopRepo {
  return {
    transaction: (fn) =>
      withTransaction(db, (tx) =>
        fn({ ...createPostShopRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    recent: (mapId, userId, since) =>
      db
        .select({
          id: postPurchases.id,
          itemId: postPurchases.itemId,
          day: postPurchases.day,
          consumedAt: postPurchases.consumedAt,
        })
        .from(postPurchases)
        .where(
          and(
            eq(postPurchases.mapId, mapId),
            eq(postPurchases.userId, userId),
            sql`(${gte(postPurchases.day, since)} or ${heldLureWhere()})`,
          ),
        )
        .orderBy(asc(postPurchases.day), asc(postPurchases.createdAt)),

    insert: async (row) => {
      await db.insert(postPurchases).values(row);
    },
  };
}

const heldLureWhere = () =>
  and(eq(postPurchases.itemId, 'rare-lure'), isNull(postPurchases.consumedAt));

/** The player's Rare Lure waiting on this patch, or null. A plain read: no lock. */
export async function heldLure(
  db: Executor,
  mapId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: postPurchases.id })
    .from(postPurchases)
    .where(and(eq(postPurchases.mapId, mapId), eq(postPurchases.userId, userId), heldLureWhere()))
    .limit(1);
  return row ?? null;
}

/**
 * Uses a held lure on a wild battle, in the start's transaction after the
 * battle row (tech spec §7 step 5d): a single-row update that only a lure
 * still waiting matches. False if it was already used (a double tap).
 */
export async function markLureUsed(
  tx: Executor,
  lureId: string,
  battleId: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx
    .update(postPurchases)
    .set({ consumedAt: at, consumedBattleId: battleId })
    .where(and(eq(postPurchases.id, lureId), isNull(postPurchases.consumedAt)))
    .returning({ id: postPurchases.id });
  return rows.length === 1;
}
