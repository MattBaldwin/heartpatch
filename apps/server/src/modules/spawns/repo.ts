import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { battles, mapMembers, maps, speciesSeen, squishies, tiles } from '../../db/schema.js';

/** What spawning needs to know about a map. `seed` is secret (tech spec §8). */
export interface SpawnMapRow {
  id: string;
  timeZone: string;
  /** Null on hand-authored maps (tutorial, local seed data). */
  seed: string | null;
  kind: 'multiplayer' | 'tutorial';
}

export interface SpawnTileRow {
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
}

export interface SeenRow {
  speciesId: string;
  firstSeenAt: Date;
  firstCaughtAt: Date | null;
}

/**
 * Wild spawns and the catalog (`species_seen`). Plain queries; services
 * decide the rules. Battles write the catalog through this repo on their own
 * transaction (`createSpawnsRepo(tx)`).
 */
export interface SpawnsRepo {
  findMap: (mapId: string) => Promise<SpawnMapRow | null>;
  listTiles: (mapId: string) => Promise<SpawnTileRow[]>;
  /**
   * Tiles whose wild squishy this player is done with for this spawn window:
   * befriended (#14), beaten without befriending (it wandered off, owner
   * decision 2026-10-03), or lost to, a run home included (it wandered off
   * too, so "Find a squishy" moves on: owner decision 2026-10-06, #208). Any
   * finished battle with a winner counts; a tie or a no contest leaves it
   * there. With `befriendedOnly`, only a befriend counts (the Tutorial Glade,
   * where beaten ones stay, #24).
   */
  goneSpawns: (
    mapId: string,
    userId: string,
    window: string,
    befriendedOnly?: boolean,
  ) => Promise<{ q: number; r: number }[]>;
  /** The player met these species (started a battle with them). Keeps the first time. */
  markSeen: (
    mapId: string,
    userId: string,
    speciesIds: readonly string[],
    at: Date,
  ) => Promise<void>;
  /** The player befriended one. Keeps the first time (and marks it seen if somehow it wasn't). */
  markCaught: (mapId: string, userId: string, speciesId: string, at: Date) => Promise<void>;
  listSeen: (mapId: string, userId: string) => Promise<SeenRow[]>;
  /**
   * The level of the player's Partner on this map (the starter they picked,
   * `map_members.starter_squishy_id`), or null if they have none.
   */
  partnerLevel: (mapId: string, userId: string) => Promise<number | null>;
}

export function createSpawnsRepo(db: Executor): SpawnsRepo {
  return {
    findMap: async (mapId) => {
      const [row] = await db
        .select({ id: maps.id, timeZone: maps.timeZone, seed: maps.seed, kind: maps.kind })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row ?? null;
    },

    listTiles: (mapId) =>
      db
        .select({ q: tiles.q, r: tiles.r, terrain: tiles.terrain, ownerUserId: tiles.ownerUserId })
        .from(tiles)
        .where(eq(tiles.mapId, mapId))
        .orderBy(asc(tiles.q), asc(tiles.r)),

    goneSpawns: async (mapId, userId, window, befriendedOnly = false) => {
      const rows = await db
        .select({ q: battles.spawnQ, r: battles.spawnR })
        .from(battles)
        .where(
          and(
            eq(battles.mapId, mapId),
            eq(battles.playerUserId, userId),
            eq(battles.spawnWindow, window),
            isNotNull(battles.result),
            // The player is always side `a` (battles service, `PLAYER_SIDE`),
            // so `b` is a loss or a run home. A no contest has no result.
            befriendedOnly
              ? sql`${battles.result} ->> 'reason' = 'captured'`
              : sql`${battles.result} ->> 'winner' in ('a', 'b')`,
          ),
        );
      return rows.flatMap(({ q, r }) => (q === null || r === null ? [] : [{ q, r }]));
    },

    markSeen: async (mapId, userId, speciesIds, at) => {
      const unique = [...new Set(speciesIds)];
      if (unique.length === 0) return;
      await db
        .insert(speciesSeen)
        .values(unique.map((speciesId) => ({ mapId, userId, speciesId, firstSeenAt: at })))
        .onConflictDoNothing();
    },

    markCaught: async (mapId, userId, speciesId, at) => {
      await db
        .insert(speciesSeen)
        .values({ mapId, userId, speciesId, firstSeenAt: at, firstCaughtAt: at })
        .onConflictDoUpdate({
          target: [speciesSeen.mapId, speciesSeen.userId, speciesSeen.speciesId],
          set: {
            firstCaughtAt: sql`coalesce(${speciesSeen.firstCaughtAt}, excluded.first_caught_at)`,
          },
        });
    },

    listSeen: (mapId, userId) =>
      db
        .select({
          speciesId: speciesSeen.speciesId,
          firstSeenAt: speciesSeen.firstSeenAt,
          firstCaughtAt: speciesSeen.firstCaughtAt,
        })
        .from(speciesSeen)
        .where(and(eq(speciesSeen.mapId, mapId), eq(speciesSeen.userId, userId)))
        .orderBy(asc(speciesSeen.firstSeenAt), asc(speciesSeen.speciesId)),

    partnerLevel: async (mapId, userId) => {
      const [row] = await db
        .select({ level: squishies.level })
        .from(mapMembers)
        .innerJoin(squishies, eq(squishies.id, mapMembers.starterSquishyId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, userId)));
      return row?.level ?? null;
    },
  };
}
