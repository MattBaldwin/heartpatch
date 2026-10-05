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
import { mapLocalTime } from '../../lib/time.js';
import { DUSK_MINUTES } from './limits.js';
import type { BattleArena, BattlesRepo } from './repo.js';

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
  repo: Pick<BattlesRepo, 'tileTerrain' | 'homeTiles'>,
  context: { mapId: string; userId: string; timeZone: string; at: Date; tile: Hex | null },
): Promise<BattleArena> {
  const { mapId, userId, tile } = context;
  const where = tile ?? heartSeedOf(await repo.homeTiles(mapId, userId));
  const terrain = where ? await repo.tileTerrain(mapId, where.q, where.r) : null;
  return {
    terrain: terrain ?? MAP_GEN.homeTerrain,
    timeOfDay: arenaTimeOfDay(mapLocalTime(context.at, context.timeZone)),
  };
}
