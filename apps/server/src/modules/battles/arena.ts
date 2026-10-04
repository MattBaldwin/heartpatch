import {
  heartSeedOf,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  isNightAt,
  MAP_GEN,
  type BattleTimeOfDay,
  type Hex,
  type MapLocalTime,
} from '@heartpatch/shared';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { mapMembers, tiles } from '../../db/schema.js';
import { mapLocalTime } from '../../lib/time.js';
import { DUSK_MINUTES } from './limits.js';
import type { BattleArena } from './repo.js';

/*
 * Where a battle happens (owner decision 2026-10-04): the terrain the client
 * draws as the arena, and the patch's time of day. The server decides it when
 * the battle starts (CLAUDE.md rule 1) and stores it on the battle, so a
 * refresh or a replay shows the same place. Only for how the arena looks:
 * nothing in the battle depends on it.
 */

/** The patch's time of day at `local`: the map's night (as the Hollow's), dusk just before it. */
export function arenaTimeOfDay(local: MapLocalTime): BattleTimeOfDay {
  const night = {
    nightfallMinute: HOME_BASE_RULES.nightfallMinute,
    morningMinute: HOLLOW_RULES.morningMinute,
  };
  if (isNightAt(local, night)) return 'night';
  return local.minute >= night.nightfallMinute - DUSK_MINUTES ? 'dusk' : 'day';
}

/**
 * The arena for a battle starting at `at` on `tile` (a tile battle's tile, a
 * wild squishy's spawn tile), or at the player's Heart Seed when the battle
 * has no tile (the dev route, a rescue). Falls back to the map's home terrain
 * if neither is found.
 */
export async function arenaFor(
  db: Executor,
  context: { mapId: string; userId: string; timeZone: string; at: Date; tile: Hex | null },
): Promise<BattleArena> {
  const { mapId, userId, tile } = context;
  const where = tile ?? (await heartSeed(db, mapId, userId));
  let terrain: string | null = null;
  if (where) {
    const [row] = await db
      .select({ terrain: tiles.terrain })
      .from(tiles)
      .where(and(eq(tiles.mapId, mapId), eq(tiles.q, where.q), eq(tiles.r, where.r)));
    terrain = row?.terrain ?? null;
  }
  return {
    terrain: terrain ?? MAP_GEN.homeTerrain,
    timeOfDay: arenaTimeOfDay(mapLocalTime(context.at, context.timeZone)),
  };
}

/** The player's Heart Seed on the map (the middle of their home base), or null. */
async function heartSeed(db: Executor, mapId: string, userId: string): Promise<Hex | null> {
  const home = await db
    .select({ q: tiles.q, r: tiles.r })
    .from(tiles)
    .innerJoin(
      mapMembers,
      and(eq(mapMembers.mapId, tiles.mapId), eq(mapMembers.homeSlot, tiles.homeSlot)),
    )
    .where(and(eq(tiles.mapId, mapId), eq(mapMembers.userId, userId)));
  return heartSeedOf(home);
}
