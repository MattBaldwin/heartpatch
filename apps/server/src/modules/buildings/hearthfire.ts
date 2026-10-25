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
  type SafeFire,
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
    // Napping for unpaid upkeep (#601): resource buildings, the Warehouse
    // and Wild Isle works (#621 W1-8) only.
    ...(row.kind === 'resource' || row.kind === 'warehouse' || row.kind === 'works'
      ? { paused: row.pausedAt !== null }
      : {}),
    // Knocked about by a storm (Wild Isle #621): only ever set there.
    ...(row.damagedAt !== null ? { knocked: true } : {}),
  };
}

/**
 * Tiles safe on the night of `local`: every home base on the map, always
 * (the Heart Seed keeps it safe, owner decision 2026-10-07), plus each lit
 * fire's tile and radius out on captured land (shared `safeTiles`).
 * `homeTiles` is every home tile on the map, every player's; `lights` are
 * lit every night without fuel (a won Lantern Tower, #306 PR 3b).
 */
export function litSafeTiles(
  fires: readonly BuildingRow[],
  homeTiles: readonly { q: number; r: number }[],
  local: MapLocalTime,
  lights: readonly SafeFire[] = [],
): Set<HexKey> {
  const lit = fires.flatMap((row) => {
    const radius = safeRadiusOf(row);
    if (radius === null) return [];
    if (!hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).lit) return [];
    return [{ at: { q: row.q, r: row.r }, radius }];
  });
  return safeTiles([...lit, ...lights], homeTiles);
}
