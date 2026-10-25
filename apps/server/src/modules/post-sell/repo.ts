import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { clothingOwned, tradeLines, tradeOffers } from '../../db/schema.js';

/** The ledger reason a sale writes on the items it takes. */
export const SELL_REASON = 'post-sell';

/** One of the player's pieces of a clothing item, as a sale sees it. */
export interface SellPieceRow {
  id: string;
  itemId: string;
  /** The offer holding it in escrow (#271), or null if it's free. */
  heldByOfferId: string | null;
}

/**
 * Storage for selling to the trading post (#601 PR 3). No table of its own
 * (no migration): a sale is its `post-sell` resource ledger rows and its
 * `sell` Heart Coin ledger row, both against the sale id; a sold clothing
 * piece's `clothing_owned` row is deleted.
 */
export interface PostSellRepo {
  transaction: <T>(fn: (repo: PostSellRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /**
   * Row-locks every piece of these items the player has in one statement, in
   * id order across the items (tech spec §7 step 10b, as trades lock pieces):
   * one sale or offer of those pieces at a time, so the last copy is never
   * sold.
   */
  lockPieces: (userId: string, itemIds: readonly string[]) => Promise<SellPieceRow[]>;
  /** Of these pieces, the ones an open offer names on either side (a patch-mate may want one). */
  inOpenOffers: (pieceIds: readonly string[]) => Promise<Set<string>>;
  /** Free (not held) copies of each clothing item the player has. */
  freeCopies: (userId: string) => Promise<Map<string, number>>;
  /** Deletes sold pieces. Closed offers that named them keep their other lines. */
  deletePieces: (ids: readonly string[]) => Promise<void>;
}

export function createPostSellRepo(db: Executor): PostSellRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createPostSellRepo(tx), tx)),

    lockPieces: (userId, itemIds) =>
      db
        .select({
          id: clothingOwned.id,
          itemId: clothingOwned.itemId,
          heldByOfferId: clothingOwned.heldByOfferId,
        })
        .from(clothingOwned)
        .where(and(eq(clothingOwned.userId, userId), inArray(clothingOwned.itemId, [...itemIds])))
        .orderBy(asc(clothingOwned.id))
        .for('update'),

    inOpenOffers: async (pieceIds) => {
      if (pieceIds.length === 0) return new Set();
      const rows = await db
        .selectDistinct({ id: tradeLines.clothingId })
        .from(tradeLines)
        .innerJoin(tradeOffers, eq(tradeOffers.id, tradeLines.offerId))
        .where(and(inArray(tradeLines.clothingId, [...pieceIds]), eq(tradeOffers.status, 'open')));
      return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
    },

    freeCopies: async (userId) => {
      const rows = await db
        .select({ itemId: clothingOwned.itemId, n: sql<number>`count(*)::int` })
        .from(clothingOwned)
        .where(and(eq(clothingOwned.userId, userId), isNull(clothingOwned.heldByOfferId)))
        .groupBy(clothingOwned.itemId);
      return new Map(rows.map((r) => [r.itemId, r.n]));
    },

    deletePieces: async (ids) => {
      if (ids.length === 0) return;
      await db.delete(clothingOwned).where(inArray(clothingOwned.id, [...ids]));
    },
  };
}
