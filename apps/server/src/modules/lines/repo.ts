import type { LineKind } from '@heartpatch/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { tileLines, tiles } from '../../db/schema.js';

/** A `tile_lines` row with its tile's place and owner now. */
export interface LineRow {
  tileId: string;
  q: number;
  r: number;
  kind: LineKind;
  ownerUserId: string;
  level: number;
  /** Who holds the tile now: a line counts only while that's its owner. */
  tileOwnerUserId: string | null;
}

/**
 * Storage for Clockwork Isle lines (#874): wires and rails, one of each
 * kind per tile. Lock order (tech spec §7): a line row is step 6, right
 * after the tile's `tile_roads` row and before buildings, in
 * `(tile_id, kind)` order.
 */
export interface LinesRepo {
  transaction: <T>(fn: (repo: LinesTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** Every line on the map whose owner still holds its tile, in (q, r, kind) order. */
  listLive: (mapId: string, kind?: LineKind) => Promise<LineRow[]>;
  /** Row-locks a tile's line of this kind (step 6), stale or live; null with none. */
  lockLine: (tileId: string, kind: LineKind) => Promise<LineRow | null>;
  /** Row-locks every line on these tiles in `(tile_id, kind)` order (land lost, step 6). */
  lockOnTiles: (tileIds: readonly string[]) => Promise<LineRow[]>;
  insertLine: (row: {
    tileId: string;
    kind: LineKind;
    mapId: string;
    ownerUserId: string;
    level: number;
    builtAt: Date;
  }) => Promise<void>;
  setLevel: (tileId: string, kind: LineKind, level: number) => Promise<void>;
  deleteLine: (tileId: string, kind: LineKind) => Promise<void>;
  /** Deletes every line on these tiles. */
  deleteOnTiles: (tileIds: readonly string[]) => Promise<void>;
}

export interface LinesTxRepo extends LinesRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const lineColumns = {
  tileId: tileLines.tileId,
  q: tiles.q,
  r: tiles.r,
  kind: tileLines.kind,
  ownerUserId: tileLines.ownerUserId,
  level: tileLines.level,
  tileOwnerUserId: tiles.ownerUserId,
};

/** The DB CHECK keeps `kind` to the two; this narrows the text column's type. */
const toLine = (row: Omit<LineRow, 'kind'> & { kind: string }): LineRow => ({
  ...row,
  kind: row.kind as LineKind,
});

export function createLinesRepo(db: Executor): LinesRepo {
  return queries(db);
}

function queries(db: Executor): LinesRepo {
  return {
    transaction: (fn) =>
      withTransaction(db, (tx) =>
        fn({ ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    listLive: async (mapId, kind) =>
      (
        await db
          .select(lineColumns)
          .from(tileLines)
          .innerJoin(tiles, eq(tiles.id, tileLines.tileId))
          .where(
            and(
              eq(tileLines.mapId, mapId),
              eq(tiles.ownerUserId, tileLines.ownerUserId),
              kind ? eq(tileLines.kind, kind) : undefined,
            ),
          )
          .orderBy(asc(tiles.q), asc(tiles.r), asc(tileLines.kind))
      ).map(toLine),

    lockLine: async (tileId, kind) => {
      const [row] = await db
        .select(lineColumns)
        .from(tileLines)
        .innerJoin(tiles, eq(tiles.id, tileLines.tileId))
        .where(and(eq(tileLines.tileId, tileId), eq(tileLines.kind, kind)))
        .for('update', { of: tileLines });
      return row ? toLine(row) : null;
    },

    lockOnTiles: async (tileIds) => {
      if (tileIds.length === 0) return [];
      return (
        await db
          .select(lineColumns)
          .from(tileLines)
          .innerJoin(tiles, eq(tiles.id, tileLines.tileId))
          .where(inArray(tileLines.tileId, [...tileIds]))
          .orderBy(asc(tileLines.tileId), asc(tileLines.kind))
          .for('update', { of: tileLines })
      ).map(toLine);
    },

    insertLine: async (row) => {
      await db.insert(tileLines).values(row);
    },

    setLevel: async (tileId, kind, level) => {
      await db
        .update(tileLines)
        .set({ level })
        .where(and(eq(tileLines.tileId, tileId), eq(tileLines.kind, kind)));
    },

    deleteLine: async (tileId, kind) => {
      await db.delete(tileLines).where(and(eq(tileLines.tileId, tileId), eq(tileLines.kind, kind)));
    },

    deleteOnTiles: async (tileIds) => {
      if (tileIds.length === 0) return;
      await db.delete(tileLines).where(inArray(tileLines.tileId, [...tileIds]));
    },
  };
}
