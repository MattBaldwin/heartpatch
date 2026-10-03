import {
  deriveSeed,
  GAME_DATA,
  STARTERS,
  hexKey,
  hexNeighbors,
  type Catalog,
  type Hex,
  type PublicUser,
  type Species,
  type WildHints,
} from '@heartpatch/shared';
import {
  resolveWildSpawn,
  SERVER_GAME_DATA,
  SPAWN_RULES,
  SPAWN_TABLES,
  type SpawnData,
  type WildSpawn,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { spawnWindowFor, type Clock } from '../../lib/time.js';
import type { WildEncounter, WildEncounterContext } from '../battles/service.js';
import { requireMember } from '../maps/members.js';
import { createSpawnsRepo, type SpawnTileRow } from './repo.js';

/*
 * Wild squishies (#14; design doc §4, §15; tech spec §8 "No rerolls"). A
 * tile's wild squishy is fixed for each spawn window: it's rolled from
 * `deriveSeed(mapSeed, 'spawn', q, r, windowId)`, a seed that is never sent
 * anywhere, against the secret spawn tables. Nothing about it is stored until
 * a player battles it. Once a player befriends it, or beats it without
 * befriending it (it's tuckered out and toddles away: owner decision
 * 2026-10-03), it's gone for that player until the next window. Other players
 * can still find theirs (DECISIONS #14).
 *
 * The Tutorial Glade (#24) is different in two ways: its wild squishies are
 * the three starters, so the friend a player befriends there (their Partner)
 * is one the starter pick offers; and one they beat without befriending stays,
 * so they can always try again (nothing can be lost in the tutorial).
 */

export interface SpawnsService {
  /** The battles module's `findWildEncounter` port. */
  findWildEncounter: (context: WildEncounterContext) => Promise<WildEncounter | null>;
  /** Tiles in reach with a wild squishy for this player, this window. No species. */
  wildHints: (user: PublicUser, mapId: string) => Promise<WildHints>;
  /** What the player has seen and befriended on this map. */
  catalog: (user: PublicUser, mapId: string) => Promise<Catalog>;
}

export interface SpawnsServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Tests pass their own tables and species. Defaults to the shipped server data. */
  data?: SpawnData;
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  tooFar: "That spot's too far away. Try one next to your land!",
} as const;

/** Every species the server knows: public, then secret. */
const ALL_SPECIES: readonly Species[] = [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies];
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));

export function defaultSpawnData(): SpawnData {
  return {
    tables: SPAWN_TABLES,
    species: new Map(ALL_SPECIES.map((s) => [s.id, s])),
    seasons: GAME_DATA.seasons,
    rules: SPAWN_RULES,
  };
}

/**
 * The Glade's wild squishy on a tile: a starter, by `(q - r) mod 3`, so tiles
 * next to each other always show different ones and all three are around the
 * home base. Battles set the level from `tutorialOverrides`.
 */
export function gladeSpawn(tile: Hex): WildSpawn {
  const speciesId = STARTERS.speciesIds[(((tile.q - tile.r) % 3) + 3) % 3];
  if (speciesId === undefined) throw new Error('gladeSpawn: no starters');
  return { speciesId, level: 1 };
}

/** A tile with what's on it this window. */
interface TileSpawn {
  tile: SpawnTileRow;
  spawn: WildSpawn;
}

export function createSpawnsService(options: SpawnsServiceOptions): SpawnsService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const data = options.data ?? defaultSpawnData();
  const store = createSpawnsRepo(db);

  /**
   * Tiles the player can look for squishies on: their own land, then the
   * tiles next to it (the same reach as claiming, design doc §11), each group
   * in (q, r) order so the nearest pick is stable.
   */
  const reachOf = (tiles: readonly SpawnTileRow[], userId: string): SpawnTileRow[] => {
    const own = tiles.filter((t) => t.ownerUserId === userId);
    const ownKeys = new Set(own.map(hexKey));
    const frontier = new Set(own.flatMap((t) => hexNeighbors(t).map(hexKey)));
    const next = tiles.filter((t) => !ownKeys.has(hexKey(t)) && frontier.has(hexKey(t)));
    return [...own, ...next];
  };

  /**
   * What's on the player's tiles in reach right now, nearest first, leaving
   * out the ones they already befriended or beat this window. With `only`, just that
   * tile (which must be in reach).
   */
  const spawnsFor = async (
    mapId: string,
    userId: string,
    at: Date,
    only: Hex | null,
  ): Promise<{ found: TileSpawn[]; window: string }> => {
    const map = await store.findMap(mapId);
    if (!map) throw new AppError('NOT_FOUND', MESSAGES.noMap);
    const window = spawnWindowFor(at, map.timeZone, data.rules.windowHours);
    let reach = reachOf(await store.listTiles(mapId), userId);
    if (only) {
      reach = reach.filter((t) => t.q === only.q && t.r === only.r);
      if (reach.length === 0) throw new AppError('NOT_FOUND', MESSAGES.tooFar);
    }
    const tutorial = map.kind === 'tutorial';
    const gone = new Set((await store.goneSpawns(mapId, userId, window.id, tutorial)).map(hexKey));
    // Hand-authored maps have no secret seed; their spawns key off the map id.
    const mapSeed = map.seed ?? deriveSeed('hand-authored-map', map.id);
    const found = reach.flatMap((tile): TileSpawn[] => {
      if (gone.has(hexKey(tile))) return [];
      if (tutorial) return [{ tile, spawn: gladeSpawn(tile) }];
      const seed = deriveSeed(mapSeed, 'spawn', tile.q, tile.r, window.id);
      const spawn = resolveWildSpawn({ seed, terrain: tile.terrain, window }, data);
      return spawn ? [{ tile, spawn }] : [];
    });
    return { found, window: window.id };
  };

  return {
    findWildEncounter: async ({ mapId, userId, now: at, tile }) => {
      const { found, window } = await spawnsFor(mapId, userId, at, tile);
      const first = found[0];
      if (!first) return null;
      return {
        squishies: [{ id: 'wild-1', speciesId: first.spawn.speciesId, level: first.spawn.level }],
        spawn: { q: first.tile.q, r: first.tile.r, window },
      };
    },

    wildHints: async (user, mapId) => {
      await requireMember(db, user, mapId);
      const { found } = await spawnsFor(mapId, user.id, now(), null);
      return { tiles: found.map(({ tile }) => ({ q: tile.q, r: tile.r })) };
    },

    catalog: async (user, mapId) => {
      await requireMember(db, user, mapId);
      const seen = await store.listSeen(mapId, user.id);
      // Secret species go only to a player who has met them (CLAUDE.md rule 6).
      const speciesDefs = seen.flatMap(({ speciesId }) => {
        const species = data.species.get(speciesId);
        return species && !PUBLIC_SPECIES.has(speciesId) ? [species] : [];
      });
      return {
        entries: seen.map((row) => ({
          speciesId: row.speciesId,
          firstSeenAt: row.firstSeenAt.toISOString(),
          firstCaughtAt: row.firstCaughtAt?.toISOString() ?? null,
        })),
        speciesDefs,
      };
    },
  };
}
