/**
 * Storage for the dev fast-forward (#736). Plain queries; the service keeps
 * tech spec §7's lock order (member row, tiles, squishies).
 */
import { and, asc, eq, inArray, isNull, sql, type AnyColumn } from 'drizzle-orm';
import type { ElementId, FeelingId } from '@heartpatch/shared';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { mapMembers, squishies, tiles } from '../../db/schema.js';

export interface FastForwardTile {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  communityId: string | null;
  isle: number | null;
}

export interface FastForwardSquishy {
  id: string;
  speciesId: string;
  level: number;
  teamSlot: number | null;
}

const tileColumns = {
  id: tiles.id,
  q: tiles.q,
  r: tiles.r,
  terrain: tiles.terrain,
  ownerUserId: tiles.ownerUserId,
  homeSlot: tiles.homeSlot,
  communityId: tiles.communityId,
  isle: tiles.isle,
};

const squishyColumns = {
  id: squishies.id,
  speciesId: squishies.speciesId,
  level: squishies.level,
  teamSlot: squishies.teamSlot,
};

/** `column`, or `at` if that's earlier: nothing gets younger. */
const noLaterThan = (column: AnyColumn, at: Date) =>
  sql`least(${column}, ${at.toISOString()}::timestamptz)`;

export function createFastForwardRepo(db: Executor) {
  return {
    /** Runs `fn` in one transaction (the service keeps tech spec §7's lock order). */
    transaction: <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn),

    listTiles: (mapId: string): Promise<FastForwardTile[]> =>
      db.select(tileColumns).from(tiles).where(eq(tiles.mapId, mapId)),

    /** Row-locks these tiles in id order (step 6) and reads them again. */
    lockTiles: async (ids: readonly string[]): Promise<FastForwardTile[]> => {
      if (ids.length === 0) return [];
      return db
        .select(tileColumns)
        .from(tiles)
        .where(inArray(tiles.id, [...ids]))
        .orderBy(asc(tiles.id))
        .for('no key update');
    },

    claimTiles: async (mapId: string, ids: readonly string[], userId: string): Promise<void> => {
      if (ids.length === 0) return;
      await db
        .update(tiles)
        .set({ ownerUserId: userId })
        .where(and(eq(tiles.mapId, mapId), inArray(tiles.id, [...ids]), isNull(tiles.ownerUserId)));
    },

    /** Row-locks my active squishies on the map in id order (step 10). */
    lockMine: (mapId: string, userId: string): Promise<FastForwardSquishy[]> =>
      db
        .select(squishyColumns)
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            eq(squishies.state, 'active'),
          ),
        )
        .orderBy(asc(squishies.id))
        .for('no key update'),

    /** The Partner grows up: its level, and its species when it evolved on the way. */
    setGrowth: async (
      id: string,
      growth: { speciesId: string; element: ElementId; feeling: FeelingId; level: number },
    ): Promise<void> => {
      await db
        .update(squishies)
        .set({ ...growth, xp: 0 })
        .where(eq(squishies.id, id));
    },

    insertSquishy: async (squishy: {
      mapId: string;
      ownerUserId: string;
      speciesId: string;
      element: ElementId;
      feeling: FeelingId;
      level: number;
      contentment: number;
      teamSlot: number | null;
      at: Date;
      /** When it joined me: the fast-forward's start, not now. */
      createdAt: Date;
    }): Promise<void> => {
      const { contentment, at, ...rest } = squishy;
      // As `insertSquishy` in battles/repo.ts: joins at its level, cared for now.
      await db.insert(squishies).values({
        ...rest,
        joinedLevel: rest.level,
        contentmentAtLastCare: contentment,
        lastCaredAt: at,
        contentment,
        contentmentSince: at,
      });
    },

    /** The account has been on the patch since `since`, and so have these (locked) squishies. */
    backdate: async (
      mapId: string,
      userId: string,
      squishyIds: readonly string[],
      since: Date,
    ): Promise<void> => {
      await db
        .update(mapMembers)
        .set({ joinedAt: noLaterThan(mapMembers.joinedAt, since) })
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, userId)));
      if (squishyIds.length === 0) return;
      await db
        .update(squishies)
        .set({ createdAt: noLaterThan(squishies.createdAt, since) })
        .where(inArray(squishies.id, [...squishyIds]));
    },
  };
}

export type FastForwardRepo = ReturnType<typeof createFastForwardRepo>;
