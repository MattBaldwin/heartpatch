import {
  SquishyStateSchema,
  TradeLineSchema,
  type SquishyState,
  type TradeKind,
  type TradeLine,
  type TradeStatus,
} from '@heartpatch/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  clothingOwned,
  inventories,
  mailbox,
  mapMembers,
  maps,
  speciesSeen,
  squishies,
  squishyAccessories,
  tiles,
  tradeLedger,
  tradeLines,
  tradeOffers,
} from '../../db/schema.js';
import { squishyAtWork } from '../jobs/repo.js';
import { squishyOnWatch } from '../territory/repo.js';

/** A trade offer's row (#271). */
export interface OfferRow {
  id: string;
  mapId: string;
  kind: TradeKind;
  fromUserId: string;
  toUserId: string;
  status: TradeStatus;
  noteId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** A line as stored, with its side. */
export interface LineRow {
  offerId: string;
  side: 'give' | 'want';
  line: TradeLine;
}

/** One of a player's squishies, as trading needs it. */
export interface TradeSquishyRow {
  id: string;
  ownerUserId: string;
  speciesId: string;
  level: number;
  nickname: string | null;
  state: SquishyState;
  teamSlot: number | null;
  training: boolean;
  onWatch: boolean;
  atWork: boolean;
}

/** One clothing piece. */
export interface TradePieceRow {
  id: string;
  userId: string;
  itemId: string;
  heldByOfferId: string | null;
}

/** A mailbox row. */
export interface MailboxRow {
  id: string;
  mapId: string;
  userId: string;
  offerId: string;
  kind: 'trade' | 'gift' | 'return';
  lines: TradeLine[];
  readyAt: Date;
  pickedUpAt: Date | null;
}

const LinesJsonSchema = z.array(TradeLineSchema);

const offerColumns = {
  id: tradeOffers.id,
  mapId: tradeOffers.mapId,
  kind: tradeOffers.kind,
  fromUserId: tradeOffers.fromUserId,
  toUserId: tradeOffers.toUserId,
  status: tradeOffers.status,
  noteId: tradeOffers.noteId,
  createdAt: tradeOffers.createdAt,
  expiresAt: tradeOffers.expiresAt,
};

const mailboxColumns = {
  id: mailbox.id,
  mapId: mailbox.mapId,
  userId: mailbox.userId,
  offerId: mailbox.offerId,
  kind: mailbox.kind,
  lines: mailbox.lines,
  readyAt: mailbox.readyAt,
  pickedUpAt: mailbox.pickedUpAt,
};

const toMailbox = (row: {
  id: string;
  mapId: string;
  userId: string;
  offerId: string;
  kind: 'trade' | 'gift' | 'return';
  lines: unknown;
  readyAt: Date;
  pickedUpAt: Date | null;
}): MailboxRow => ({ ...row, lines: LinesJsonSchema.parse(row.lines) });

const squishyColumns = {
  id: squishies.id,
  ownerUserId: squishies.ownerUserId,
  speciesId: squishies.speciesId,
  level: squishies.level,
  nickname: squishies.nickname,
  state: squishies.state,
  teamSlot: squishies.teamSlot,
  trainingBuildingId: squishies.trainingBuildingId,
};

/** A stored line as a `TradeLine` (the check constraint keeps them whole). */
function lineOf(row: {
  kind: 'squishy' | 'item' | 'clothing';
  squishyId: string | null;
  itemId: string | null;
  quantity: number | null;
  clothingId: string | null;
}): TradeLine | null {
  if (row.kind === 'squishy')
    return row.squishyId ? { kind: 'squishy', squishyId: row.squishyId } : null;
  if (row.kind === 'item') {
    return row.itemId && row.quantity
      ? { kind: 'item', itemId: row.itemId, quantity: row.quantity }
      : null;
  }
  return row.clothingId ? { kind: 'clothing', clothingId: row.clothingId } : null;
}

/**
 * Storage for trades and gifts (#271). Plain queries; the service decides
 * the rules and the lock order (tech spec §7: offers then mailbox at step 9b,
 * squishies at 10, clothing at 10b, inventory at 11, `maps` last).
 */
/** `appendGameEvent` in this transaction; events are its last writes (`maps` last). */
export const appendTradeEvent = <T extends NewGameEvent['type']>(
  tx: Transaction,
  event: NewGameEvent<T>,
): Promise<GameEvent> => appendGameEvent(tx, event);

export function createTradesRepo(db: Executor) {
  return {
    /** Dev only (`HP_DEV_SQUISHY_GRANTS`): hands these neutral tiles to the player. */
    devClaimTiles: async (mapId: string, ids: readonly string[], userId: string): Promise<void> => {
      if (ids.length === 0) return;
      await db
        .update(tiles)
        .set({ ownerUserId: userId })
        .where(and(eq(tiles.mapId, mapId), inArray(tiles.id, [...ids]), isNull(tiles.ownerUserId)));
    },

    /** Runs `fn` in one transaction (the service keeps tech spec §7's lock order). */
    transaction: <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn),
    tradingEnabled: async (mapId: string): Promise<boolean> => {
      const [row] = await db
        .select({ on: maps.tradingEnabled })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row?.on ?? false;
    },

    setTrading: async (mapId: string, on: boolean): Promise<void> => {
      await db.update(maps).set({ tradingEnabled: on }).where(eq(maps.id, mapId));
    },

    /** Is this player an active member of the map? */
    isActiveMember: async (mapId: string, userId: string): Promise<boolean> => {
      const [row] = await db
        .select({ status: mapMembers.status })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, userId)));
      return row?.status === 'active';
    },

    starterOf: async (mapId: string, userId: string): Promise<string | null> => {
      const [row] = await db
        .select({ id: mapMembers.starterSquishyId })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, userId)));
      return row?.id ?? null;
    },

    /** A player's squishies on the map, any state, with what job each has. */
    squishiesOf: async (mapId: string, userId: string): Promise<TradeSquishyRow[]> => {
      const rows = await db
        .select({ ...squishyColumns, onWatch: squishyOnWatch(), atWork: squishyAtWork() })
        .from(squishies)
        .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)))
        .orderBy(asc(squishies.id));
      return rows.map(({ trainingBuildingId, ...r }) => ({
        ...r,
        state: SquishyStateSchema.parse(r.state),
        training: trainingBuildingId !== null,
      }));
    },

    /** Row-locks these squishies in id order (step 10) and returns them, any owner. */
    lockSquishies: async (ids: readonly string[]): Promise<TradeSquishyRow[]> => {
      if (ids.length === 0) return [];
      const rows = await db
        .select({ ...squishyColumns, onWatch: squishyOnWatch(), atWork: squishyAtWork() })
        .from(squishies)
        .where(inArray(squishies.id, [...ids]))
        .orderBy(asc(squishies.id))
        .for('update', { of: squishies });
      return rows.map(({ trainingBuildingId, ...r }) => ({
        ...r,
        state: SquishyStateSchema.parse(r.state),
        training: trainingBuildingId !== null,
      }));
    },

    /** These squishies, any owner (a read, for the post screen). */
    squishiesByIds: async (ids: readonly string[]): Promise<TradeSquishyRow[]> => {
      if (ids.length === 0) return [];
      const rows = await db
        .select({ ...squishyColumns, onWatch: squishyOnWatch(), atWork: squishyAtWork() })
        .from(squishies)
        .where(inArray(squishies.id, [...ids]))
        .orderBy(asc(squishies.id));
      return rows.map(({ trainingBuildingId, ...r }) => ({
        ...r,
        state: SquishyStateSchema.parse(r.state),
        training: trainingBuildingId !== null,
      }));
    },

    /** Species the player has met on the map. */
    seenOf: async (mapId: string, userId: string): Promise<Set<string>> => {
      const rows = await db
        .select({ speciesId: speciesSeen.speciesId })
        .from(speciesSeen)
        .where(and(eq(speciesSeen.mapId, mapId), eq(speciesSeen.userId, userId)));
      return new Set(rows.map((r) => r.speciesId));
    },

    setSquishyState: async (ids: readonly string[], state: SquishyState): Promise<void> => {
      if (ids.length === 0) return;
      await db
        .update(squishies)
        .set({ state })
        .where(inArray(squishies.id, [...ids]));
    },

    /**
     * Squishies change hands: their new owner, in `state`, resting with no
     * bed (a new home picks its own), and their accessory goes back to the
     * old owner's wardrobe (DECISIONS #43: an accessory never changes hands).
     */
    moveSquishies: async (ids: readonly string[], ownerUserId: string, state: SquishyState) => {
      if (ids.length === 0) return;
      await db.delete(squishyAccessories).where(inArray(squishyAccessories.squishyId, [...ids]));
      await db
        .update(squishies)
        .set({
          ownerUserId,
          state,
          teamSlot: null,
          habitatBuildingId: null,
          habitatSince: null,
          workTileId: null,
          workSince: null,
          workStartedAt: null,
          trainingBuildingId: null,
          trainingSince: null,
        })
        .where(inArray(squishies.id, [...ids]));
    },

    /** A player's clothing pieces (stored ones; starter items aren't stored). */
    piecesOf: async (userId: string): Promise<TradePieceRow[]> =>
      db
        .select({
          id: clothingOwned.id,
          userId: clothingOwned.userId,
          itemId: clothingOwned.itemId,
          heldByOfferId: clothingOwned.heldByOfferId,
        })
        .from(clothingOwned)
        .where(eq(clothingOwned.userId, userId))
        .orderBy(asc(clothingOwned.id)),

    /** Row-locks these pieces in id order (step 10b) and returns them. */
    lockPieces: async (ids: readonly string[]): Promise<TradePieceRow[]> => {
      if (ids.length === 0) return [];
      return db
        .select({
          id: clothingOwned.id,
          userId: clothingOwned.userId,
          itemId: clothingOwned.itemId,
          heldByOfferId: clothingOwned.heldByOfferId,
        })
        .from(clothingOwned)
        .where(inArray(clothingOwned.id, [...ids]))
        .orderBy(asc(clothingOwned.id))
        .for('update');
    },

    /** These pieces, any owner (a read). */
    piecesByIds: async (ids: readonly string[]): Promise<TradePieceRow[]> => {
      if (ids.length === 0) return [];
      return db
        .select({
          id: clothingOwned.id,
          userId: clothingOwned.userId,
          itemId: clothingOwned.itemId,
          heldByOfferId: clothingOwned.heldByOfferId,
        })
        .from(clothingOwned)
        .where(inArray(clothingOwned.id, [...ids]))
        .orderBy(asc(clothingOwned.id));
    },

    /** The player's squishies stop wearing these accessories (the last piece went). */
    takeOffAccessories: async (userId: string, itemIds: readonly string[]): Promise<void> => {
      if (itemIds.length === 0) return;
      await db
        .delete(squishyAccessories)
        .where(
          and(
            eq(squishyAccessories.userId, userId),
            inArray(squishyAccessories.itemId, [...itemIds]),
          ),
        );
    },

    /** Pieces move to `userId`, held for `offerId` (or free: null). */
    movePieces: async (ids: readonly string[], userId: string, heldByOfferId: string | null) => {
      if (ids.length === 0) return;
      await db
        .update(clothingOwned)
        .set({ userId, heldByOfferId })
        .where(inArray(clothingOwned.id, [...ids]));
    },

    /** Free pieces of this item the player still has (not held for an offer). */
    freePiecesOf: async (userId: string, itemId: string): Promise<number> => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(clothingOwned)
        .where(
          and(
            eq(clothingOwned.userId, userId),
            eq(clothingOwned.itemId, itemId),
            isNull(clothingOwned.heldByOfferId),
          ),
        );
      return row?.n ?? 0;
    },

    /** Item id → how many are in the player's bag on this map. */
    bagOf: async (mapId: string, userId: string): Promise<Record<string, number>> => {
      const rows = await db
        .select({ itemId: inventories.itemId, quantity: inventories.quantity })
        .from(inventories)
        .where(and(eq(inventories.mapId, mapId), eq(inventories.userId, userId)));
      return Object.fromEntries(rows.map((r) => [r.itemId, r.quantity]));
    },

    insertOffer: async (offer: Omit<OfferRow, 'id' | 'status'>): Promise<OfferRow> => {
      const [row] = await db.insert(tradeOffers).values(offer).returning(offerColumns);
      if (!row) throw new Error('insertOffer: no row returned');
      return row;
    },

    insertLines: async (offerId: string, side: 'give' | 'want', lines: readonly TradeLine[]) => {
      if (lines.length === 0) return;
      await db.insert(tradeLines).values(
        lines.map((line) => ({
          offerId,
          side,
          kind: line.kind,
          squishyId: line.kind === 'squishy' ? line.squishyId : null,
          itemId: line.kind === 'item' ? line.itemId : null,
          quantity: line.kind === 'item' ? line.quantity : null,
          clothingId: line.kind === 'clothing' ? line.clothingId : null,
        })),
      );
    },

    /** Every line of these offers. */
    linesOf: async (offerIds: readonly string[]): Promise<LineRow[]> => {
      if (offerIds.length === 0) return [];
      const rows = await db
        .select({
          offerId: tradeLines.offerId,
          side: tradeLines.side,
          kind: tradeLines.kind,
          squishyId: tradeLines.squishyId,
          itemId: tradeLines.itemId,
          quantity: tradeLines.quantity,
          clothingId: tradeLines.clothingId,
        })
        .from(tradeLines)
        .where(inArray(tradeLines.offerId, [...offerIds]))
        .orderBy(asc(tradeLines.id));
      return rows.flatMap((r) => {
        const line = lineOf(r);
        return line ? [{ offerId: r.offerId, side: r.side, line }] : [];
      });
    },

    /** Row-locks these offers in id order (step 9b). */
    lockOffers: async (ids: readonly string[]): Promise<OfferRow[]> => {
      if (ids.length === 0) return [];
      return db
        .select(offerColumns)
        .from(tradeOffers)
        .where(inArray(tradeOffers.id, [...ids]))
        .orderBy(asc(tradeOffers.id))
        .for('update');
    },

    /** Row-locks the map's open offers matching `where` (step 9b, id order). */
    lockOpenOffers: async (
      mapId: string,
      filter: { expiredBy?: Date; userId?: string },
    ): Promise<OfferRow[]> =>
      db
        .select(offerColumns)
        .from(tradeOffers)
        .where(
          and(
            eq(tradeOffers.mapId, mapId),
            eq(tradeOffers.status, 'open'),
            filter.expiredBy ? lte(tradeOffers.expiresAt, filter.expiredBy) : undefined,
            filter.userId
              ? or(
                  eq(tradeOffers.fromUserId, filter.userId),
                  eq(tradeOffers.toUserId, filter.userId),
                )
              : undefined,
          ),
        )
        .orderBy(asc(tradeOffers.id))
        .for('update'),

    /** Open offers past their time on the map (a read: the expiry locks them again). */
    dueOfferIds: async (mapId: string, at: Date): Promise<string[]> => {
      const rows = await db
        .select({ id: tradeOffers.id })
        .from(tradeOffers)
        .where(
          and(
            eq(tradeOffers.mapId, mapId),
            eq(tradeOffers.status, 'open'),
            lte(tradeOffers.expiresAt, at),
          ),
        );
      return rows.map((r) => r.id);
    },

    /** Who sent and who got each of these offers (a read). */
    offerParties: async (ids: readonly string[]) => {
      if (ids.length === 0) return new Map<string, { fromUserId: string; toUserId: string }>();
      const rows = await db
        .select({
          id: tradeOffers.id,
          fromUserId: tradeOffers.fromUserId,
          toUserId: tradeOffers.toUserId,
        })
        .from(tradeOffers)
        .where(inArray(tradeOffers.id, [...ids]));
      return new Map(rows.map(({ id, ...parties }) => [id, parties]));
    },

    /** Open offers a player sent on the map, and how many of them go to `toUserId`. */
    openCounts: async (mapId: string, fromUserId: string, toUserId: string) => {
      const rows = await db
        .select({ to: tradeOffers.toUserId })
        .from(tradeOffers)
        .where(
          and(
            eq(tradeOffers.mapId, mapId),
            eq(tradeOffers.fromUserId, fromUserId),
            eq(tradeOffers.status, 'open'),
          ),
        );
      return { sent: rows.length, toThem: rows.filter((r) => r.to === toUserId).length };
    },

    setStatus: async (ids: readonly string[], status: TradeStatus, at: Date): Promise<void> => {
      if (ids.length === 0) return;
      await db
        .update(tradeOffers)
        .set({ status, answeredAt: at })
        .where(inArray(tradeOffers.id, [...ids]));
    },

    /** Open offers to or from the player on the map (the post screen). */
    openOffersOf: async (mapId: string, userId: string): Promise<OfferRow[]> =>
      db
        .select(offerColumns)
        .from(tradeOffers)
        .where(
          and(
            eq(tradeOffers.mapId, mapId),
            eq(tradeOffers.status, 'open'),
            or(eq(tradeOffers.fromUserId, userId), eq(tradeOffers.toUserId, userId)),
          ),
        )
        .orderBy(desc(tradeOffers.createdAt), asc(tradeOffers.id)),

    insertMailbox: async (row: Omit<MailboxRow, 'id' | 'pickedUpAt'> & { pickedUpAt?: Date }) => {
      await db.insert(mailbox).values(row);
    },

    /** The gift's waiting mailbox row goes (the gift went back before it was picked up). */
    deleteWaitingFor: async (offerIds: readonly string[]): Promise<void> => {
      if (offerIds.length === 0) return;
      await db
        .delete(mailbox)
        .where(and(inArray(mailbox.offerId, [...offerIds]), isNull(mailbox.pickedUpAt)));
    },

    /** Row-locks the player's waiting mailbox rows (step 9b, after offers; id order). */
    lockWaiting: async (mapId: string, userId: string, ids?: readonly string[]) => {
      const rows = await db
        .select(mailboxColumns)
        .from(mailbox)
        .where(
          and(
            eq(mailbox.mapId, mapId),
            eq(mailbox.userId, userId),
            isNull(mailbox.pickedUpAt),
            ids ? inArray(mailbox.id, [...ids]) : undefined,
          ),
        )
        .orderBy(asc(mailbox.id))
        .for('update');
      return rows.map(toMailbox);
    },

    /** The player's waiting mailbox rows (a read). */
    waitingOf: async (mapId: string, userId: string): Promise<MailboxRow[]> => {
      const rows = await db
        .select(mailboxColumns)
        .from(mailbox)
        .where(
          and(eq(mailbox.mapId, mapId), eq(mailbox.userId, userId), isNull(mailbox.pickedUpAt)),
        )
        .orderBy(asc(mailbox.readyAt), asc(mailbox.id));
      return rows.map(toMailbox);
    },

    /** The player's latest return notes. */
    returnsOf: async (mapId: string, userId: string, limit: number): Promise<MailboxRow[]> => {
      const rows = await db
        .select(mailboxColumns)
        .from(mailbox)
        .where(
          and(
            eq(mailbox.mapId, mapId),
            eq(mailbox.userId, userId),
            eq(mailbox.kind, 'return'),
            isNotNull(mailbox.pickedUpAt),
          ),
        )
        .orderBy(desc(mailbox.readyAt), desc(mailbox.id))
        .limit(limit);
      return rows.map(toMailbox);
    },

    pickedUp: async (ids: readonly string[], at: Date, postTileId: string) => {
      if (ids.length === 0) return;
      await db
        .update(mailbox)
        .set({ pickedUpAt: at, pickedUpPostTileId: postTileId })
        .where(inArray(mailbox.id, [...ids]));
    },

    /** One ledger step; a repeat of the same step (same offer, event and actor) writes nothing. */
    ledger: async (step: {
      mapId: string;
      offerId: string;
      event: string;
      actorUserId: string | null;
      at: Date;
      detail?: Record<string, unknown>;
    }): Promise<void> => {
      await db
        .insert(tradeLedger)
        .values({ ...step, detail: step.detail ?? {} })
        .onConflictDoNothing();
    },
  };
}

export type TradesRepo = ReturnType<typeof createTradesRepo>;
