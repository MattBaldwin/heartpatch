import {
  GAME_DATA,
  HOME_BASE_RULES,
  hearthfireState,
  safeTiles,
  type Building,
  type FuelledThrough,
  type HearthfireState,
  type HexKey,
  type MapLocalTime,
  type PublicBuilding,
} from '@heartpatch/shared';
import { mapLocalTime } from '../../lib/time.js';
import type { BuildingRow } from './repo.js';

// Hearthfires on the server (#18; design doc §14, tech spec §7): turns the
// clock into map-local time (DST included) for the shared pure rules.
// Nightfall (#21) uses `fireStateAt` and `litSafeTiles`, with `mapLocalTime`
// from lib/time.ts.

export const BUILDING_DATA = new Map<string, Building>(GAME_DATA.buildings.map((b) => [b.id, b]));

/** A fire's state at `at` on a map in `timeZone`. */
export function fireStateAt(
  fuelledThrough: FuelledThrough,
  at: Date,
  timeZone: string,
): HearthfireState {
  return hearthfireState(fuelledThrough, mapLocalTime(at, timeZone), HOME_BASE_RULES);
}

/** The safe radius of a Hearthfire row at its level, or null for other kinds. */
export function safeRadiusOf(row: Pick<BuildingRow, 'buildingId' | 'level'>): number | null {
  const building = BUILDING_DATA.get(row.buildingId);
  if (building?.kind !== 'hearthfire') return null;
  const level = building.levels[Math.min(row.level, building.levels.length) - 1];
  return level?.safeRadius ?? null;
}

/** A building as every member sees it (`lit` as of `local`). */
export function toPublicBuilding(row: BuildingRow, local: MapLocalTime): PublicBuilding {
  const radius = safeRadiusOf(row);
  return {
    id: row.id,
    buildingId: row.buildingId,
    kind: row.kind,
    level: row.level,
    spot: row.spot,
    lit: radius === null ? null : hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).lit,
    safeRadius: radius,
  };
}

/**
 * Tiles protected for the night of `local` by lit fires: each lit fire's
 * radius, plus its owner's whole home base when the fire stands on it
 * (shared `safeTiles`). A fire out on captured land covers only its radius
 * (#202). `homeTilesOf` gives a fire's owner's home tiles, so fires of
 * several players can be passed.
 */
export function litSafeTiles(
  fires: readonly BuildingRow[],
  homeTilesOf: (ownerUserId: string) => readonly { q: number; r: number }[],
  local: MapLocalTime,
): Set<HexKey> {
  const lit = fires.flatMap((row) => {
    const radius = safeRadiusOf(row);
    if (radius === null) return [];
    if (!hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).lit) return [];
    const home = homeTilesOf(row.ownerUserId);
    const onHome = home.some((t) => t.q === row.q && t.r === row.r);
    return [{ at: { q: row.q, r: row.r }, radius, homeTiles: onHome ? home : [] }];
  });
  return safeTiles(lit);
}
