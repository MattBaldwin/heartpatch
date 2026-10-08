import { and, asc, eq, gt } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { journeys, maps, tiles } from '../../db/schema.js';

/** A journey's row (#270): one per `journey` battle. */
export interface JourneyRow {
  id: string;
  mapId: string;
  userId: string;
  postTileId: string;
  /** The post's place on the map. */
  q: number;
  r: number;
  battleId: string;
  outcome: 'active' | 'won' | 'lost' | 'no-contest';
  visitUntil: Date | null;
}

/** A visit pass still good: the post and when it runs out. */
export interface VisitPassRow {
  postTileId: string;
  q: number;
  r: number;
  visitUntil: Date;
}

/**
 * Storage for journeys to trading posts (#270). Plain queries; the service
 * decides. Journeys lock only their own row, after the battle's (tech spec §7
 * step 5b): a journey's start and the post check read tiles without locking.
 */
export interface JourneysRepo {
  /** The map's secret seed (null on hand-authored maps). Server-only. */
  mapSeed: (mapId: string) => Promise<string | null>;
  insertJourney: (journey: {
    mapId: string;
    userId: string;
    postTileId: string;
    battleId: string;
    distance: number;
    level: number;
    teamSize: number;
    startedAt: Date;
  }) => Promise<{ id: string }>;
  /** Row-locks a battle's journey until commit (step 5b, after the battle). */
  lockJourneyByBattle: (battleId: string) => Promise<JourneyRow | null>;
  endJourney: (
    journeyId: string,
    outcome: 'won' | 'lost' | 'no-contest',
    at: Date,
    visitUntil: Date | null,
  ) => Promise<void>;
  /** The player's visit passes on the map still good at `at`, latest per post, in post id order. */
  visitPasses: (mapId: string, userId: string, at: Date) => Promise<VisitPassRow[]>;
}

const journeyColumns = {
  id: journeys.id,
  mapId: journeys.mapId,
  userId: journeys.userId,
  postTileId: journeys.postTileId,
  q: tiles.q,
  r: tiles.r,
  battleId: journeys.battleId,
  outcome: journeys.outcome,
  visitUntil: journeys.visitUntil,
};

export function createJourneysRepo(db: Executor): JourneysRepo {
  return {
    mapSeed: async (mapId) => {
      const [row] = await db.select({ seed: maps.seed }).from(maps).where(eq(maps.id, mapId));
      return row?.seed ?? null;
    },

    insertJourney: async (journey) => {
      const [row] = await db.insert(journeys).values(journey).returning({ id: journeys.id });
      if (!row) throw new Error('insertJourney: no row returned');
      return row;
    },

    lockJourneyByBattle: async (battleId) => {
      const [row] = await db
        .select(journeyColumns)
        .from(journeys)
        .innerJoin(tiles, eq(tiles.id, journeys.postTileId))
        .where(eq(journeys.battleId, battleId))
        .for('update', { of: journeys });
      return row ?? null;
    },

    endJourney: async (journeyId, outcome, at, visitUntil) => {
      await db
        .update(journeys)
        .set({ outcome, endedAt: at, visitUntil })
        .where(eq(journeys.id, journeyId));
    },

    visitPasses: async (mapId, userId, at) => {
      const rows = await db
        .select({
          postTileId: journeys.postTileId,
          q: tiles.q,
          r: tiles.r,
          visitUntil: journeys.visitUntil,
        })
        .from(journeys)
        .innerJoin(tiles, eq(tiles.id, journeys.postTileId))
        .where(
          and(eq(journeys.mapId, mapId), eq(journeys.userId, userId), gt(journeys.visitUntil, at)),
        )
        .orderBy(asc(journeys.postTileId));
      // The latest pass for each post (two wins in a row: the later one counts).
      const latest = new Map<string, VisitPassRow>();
      for (const row of rows) {
        if (!row.visitUntil) continue;
        const kept = latest.get(row.postTileId);
        if (!kept || kept.visitUntil < row.visitUntil) {
          latest.set(row.postTileId, { ...row, visitUntil: row.visitUntil });
        }
      }
      return [...latest.values()];
    },
  };
}
