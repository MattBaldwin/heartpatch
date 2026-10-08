import { ItemCountsSchema, type ItemCounts } from '@heartpatch/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { buildings, factoryQueues } from '../../db/schema.js';
import type { ItemOwner } from '../inventory/repo.js';

/** A Crafting Factory batch (#294), as stored. */
export interface BatchRow {
  id: string;
  mapId: string;
  userId: string;
  /** The Factory's `buildings` row. */
  buildingId: string;
  recipeId: string;
  total: number;
  /** How many are in the bag already. */
  banked: number;
  itemSeconds: number;
  /** One run's items. */
  output: ItemCounts;
  /** One run's cost. */
  inputs: ItemCounts;
  startedAt: Date;
  endedAt: Date | null;
  endReason: 'done' | 'stopped' | 'taken-down' | null;
}

export type NewBatch = Omit<BatchRow, 'id' | 'banked' | 'endedAt' | 'endReason'>;

/** My Factory's building row: just what the batches need. */
export interface FactoryRow {
  id: string;
  buildingId: string;
  level: number;
}

/**
 * Factory batch storage. Plain queries; the service keeps the rules and the
 * lock order (tech spec §7: buildings, then a craft, then batches, all step 8).
 */
export interface FactoryRepo {
  transaction: <T>(fn: (repo: FactoryTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** My Factory on this map (at most one: `maxPerHome`), unlocked. */
  findFactory: (owner: ItemOwner) => Promise<FactoryRow | null>;
  /** My batches still going, oldest first, unlocked. */
  listRunning: (owner: ItemOwner) => Promise<BatchRow[]>;
  /** Row-locks my batches still going, in id order. */
  lockRunning: (owner: ItemOwner) => Promise<BatchRow[]>;
  /** Row-locks one Factory's batches still going, in id order. */
  lockRunningIn: (buildingRowId: string) => Promise<BatchRow[]>;
  /** Row-locks one batch. */
  lockBatch: (batchId: string) => Promise<BatchRow | null>;
  insertBatch: (batch: NewBatch) => Promise<BatchRow>;
  /** Moves `banked` on, ending the batch when `end` is given. */
  setBanked: (
    batchId: string,
    banked: number,
    end: { at: Date; reason: 'done' | 'stopped' | 'taken-down' } | null,
  ) => Promise<void>;
  /** Dev and test only: my batches still going finish at `at` (`started_at` moves back). */
  makeBatchesReady: (owner: ItemOwner, at: Date) => Promise<number>;
}

export interface FactoryTxRepo extends FactoryRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const toBatch = (row: typeof factoryQueues.$inferSelect): BatchRow => ({
  ...row,
  // JSON is checked on read, so a hand-edited row fails loudly.
  output: ItemCountsSchema.parse(row.output),
  inputs: ItemCountsSchema.parse(row.inputs),
});

const runningOf = (owner: ItemOwner) =>
  and(
    eq(factoryQueues.mapId, owner.mapId),
    eq(factoryQueues.userId, owner.userId),
    isNull(factoryQueues.endedAt),
  );

export function createFactoryRepo(db: Executor): FactoryRepo {
  return queries(db);
}

function queries(db: Executor): FactoryRepo {
  return {
    transaction: (fn) =>
      withTransaction(db, (tx: Transaction) =>
        fn({ ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    findFactory: async (owner) => {
      const [row] = await db
        .select({ id: buildings.id, buildingId: buildings.buildingId, level: buildings.level })
        .from(buildings)
        .where(
          and(
            eq(buildings.mapId, owner.mapId),
            eq(buildings.ownerUserId, owner.userId),
            eq(buildings.kind, 'factory'),
          ),
        )
        .orderBy(asc(buildings.id))
        .limit(1);
      return row ?? null;
    },

    listRunning: async (owner) =>
      (
        await db
          .select()
          .from(factoryQueues)
          .where(runningOf(owner))
          .orderBy(asc(factoryQueues.startedAt), asc(factoryQueues.id))
      ).map(toBatch),

    lockRunning: async (owner) =>
      (
        await db
          .select()
          .from(factoryQueues)
          .where(runningOf(owner))
          .orderBy(asc(factoryQueues.id))
          .for('update')
      ).map(toBatch),

    lockRunningIn: async (buildingRowId) =>
      (
        await db
          .select()
          .from(factoryQueues)
          .where(and(eq(factoryQueues.buildingId, buildingRowId), isNull(factoryQueues.endedAt)))
          .orderBy(asc(factoryQueues.id))
          .for('update')
      ).map(toBatch),

    lockBatch: async (batchId) => {
      const [row] = await db
        .select()
        .from(factoryQueues)
        .where(eq(factoryQueues.id, batchId))
        .for('update');
      return row ? toBatch(row) : null;
    },

    insertBatch: async (batch) => {
      const [row] = await db.insert(factoryQueues).values(batch).returning();
      if (!row) throw new Error('insertBatch: insert returned no row');
      return toBatch(row);
    },

    setBanked: async (batchId, banked, end) => {
      await db
        .update(factoryQueues)
        .set({ banked, ...(end ? { endedAt: end.at, endReason: end.reason } : {}) })
        .where(eq(factoryQueues.id, batchId));
    },

    makeBatchesReady: async (owner, at) => {
      // Rows of one kind lock in id order (tech spec §7), before the update.
      const rows = await db
        .select({ id: factoryQueues.id })
        .from(factoryQueues)
        .where(runningOf(owner))
        .orderBy(asc(factoryQueues.id))
        .for('update');
      if (rows.length === 0) return 0;
      const moved = await db
        .update(factoryQueues)
        .set({
          startedAt: sql`${at.toISOString()}::timestamptz - make_interval(secs => ${factoryQueues.total} * ${factoryQueues.itemSeconds})`,
        })
        .where(runningOf(owner))
        .returning({ id: factoryQueues.id });
      return moved.length;
    },
  };
}
