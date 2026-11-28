import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { buildings, researchJobs, researchKnown } from '../../db/schema.js';

/** A `research_jobs` row. */
export interface ResearchJobRow {
  id: string;
  mapId: string;
  userId: string;
  buildingId: string | null;
  nodeId: string;
  startedAt: Date;
  readyAt: Date;
  claimedAt: Date | null;
}

/** A bench as a start command locks it. */
export interface BenchRow {
  id: string;
  mapId: string;
  ownerUserId: string;
  buildingId: string;
  kind: string;
  level: number;
}

/** Whose research: one player on one patch. */
export interface ResearchOwner {
  mapId: string;
  userId: string;
}

/**
 * Storage for Clockwork Isle research (#874 C3). Lock order (tech spec §7):
 * the bench (`buildings`, step 8), then my going `research_jobs` row (step
 * 8, after the buildings), then my bag (11), `maps` last. `research_known`
 * is insert-only (`ON CONFLICT DO NOTHING`), never locked.
 */
export interface ResearchRepo {
  transaction: <T>(fn: (repo: ResearchTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The node ids I know on this patch, in node id order. */
  known: (owner: ResearchOwner) => Promise<string[]>;
  /** My one unclaimed job (going or ready), or null; a plain read. */
  going: (owner: ResearchOwner) => Promise<ResearchJobRow | null>;
  /** Row-locks a building by id (`FOR NO KEY UPDATE`, step 8); null if missing. */
  lockBench: (buildingRowId: string) => Promise<BenchRow | null>;
  /** Row-locks my one unclaimed job (step 8); null with none. */
  lockGoing: (owner: ResearchOwner) => Promise<ResearchJobRow | null>;
  insertJob: (row: Omit<ResearchJobRow, 'id' | 'claimedAt'>) => Promise<ResearchJobRow>;
  /**
   * Marks a ready job claimed at `at`, only if it's still unclaimed and
   * ready by then. The guard is the `WHERE`: a second claim racing the
   * first waits on the row lock, re-reads it claimed and gets null, so a
   * job grants once however many reads race.
   */
  claim: (jobId: string, at: Date) => Promise<ResearchJobRow | null>;
  /** Marks a node known (`ON CONFLICT DO NOTHING`). */
  markKnown: (owner: ResearchOwner, nodeId: string, at: Date) => Promise<void>;
}

export interface ResearchTxRepo extends ResearchRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const mine = (owner: ResearchOwner) =>
  and(eq(researchJobs.mapId, owner.mapId), eq(researchJobs.userId, owner.userId));

export function createResearchRepo(db: Executor): ResearchRepo {
  return queries(db);
}

function queries(db: Executor): ResearchRepo {
  return {
    transaction: (fn) =>
      withTransaction(db, (tx) =>
        fn({ ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    known: async (owner) => {
      const rows = await db
        .select({ nodeId: researchKnown.nodeId })
        .from(researchKnown)
        .where(and(eq(researchKnown.mapId, owner.mapId), eq(researchKnown.userId, owner.userId)))
        .orderBy(asc(researchKnown.nodeId));
      return rows.map((r) => r.nodeId);
    },

    going: async (owner) => {
      const [row] = await db
        .select()
        .from(researchJobs)
        .where(and(mine(owner), isNull(researchJobs.claimedAt)));
      return row ?? null;
    },

    lockBench: async (buildingRowId) => {
      const [row] = await db
        .select({
          id: buildings.id,
          mapId: buildings.mapId,
          ownerUserId: buildings.ownerUserId,
          buildingId: buildings.buildingId,
          kind: buildings.kind,
          level: buildings.level,
        })
        .from(buildings)
        .where(eq(buildings.id, buildingRowId))
        .for('no key update');
      return row ?? null;
    },

    lockGoing: async (owner) => {
      const [row] = await db
        .select()
        .from(researchJobs)
        .where(and(mine(owner), isNull(researchJobs.claimedAt)))
        .for('update');
      return row ?? null;
    },

    insertJob: async (row) => {
      const [inserted] = await db.insert(researchJobs).values(row).returning();
      if (!inserted) throw new Error('research job insert returned no row');
      return inserted;
    },

    claim: async (jobId, at) => {
      const [row] = await db
        .update(researchJobs)
        .set({ claimedAt: at })
        .where(
          and(
            eq(researchJobs.id, jobId),
            isNull(researchJobs.claimedAt),
            lte(researchJobs.readyAt, at),
          ),
        )
        .returning();
      return row ?? null;
    },

    markKnown: async (owner, nodeId, at) => {
      await db
        .insert(researchKnown)
        .values({ mapId: owner.mapId, userId: owner.userId, nodeId, knownAt: at })
        .onConflictDoNothing();
    },
  };
}
