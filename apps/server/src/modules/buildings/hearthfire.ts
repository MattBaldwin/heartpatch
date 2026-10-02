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
import { localDate } from '../../lib/time.js';
import type { BuildingRow, HomeTileRow } from './repo.js';

// Hearthfires on the server (#18; design doc §14, tech spec §7): turns the
// clock into map-local time (DST included) for the shared pure rules.
// Nightfall (#21) uses `mapLocalTime`, `fireStateAt` and `litSafeTiles`.

export const BUILDING_DATA = new Map<string, Building>(GAME_DATA.buildings.map((b) => [b.id, b]));

/** Map-local wall-clock time at `at` in `timeZone` (an IANA zone). */
export function mapLocalTime(at: Date, timeZone: string): MapLocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { date: localDate(at, timeZone), minute: part('hour') * 60 + part('minute') };
}

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
  const kind = BUILDING_DATA.get(row.buildingId)?.kind ?? 'habitat';
  return {
    id: row.id,
    buildingId: row.buildingId,
    kind,
    level: row.level,
    spot: row.spot,
    lit: radius === null ? null : hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).lit,
    safeRadius: radius,
  };
}

/**
 * Tiles protected tonight by one player's lit fires: their whole home base
 * plus each lit fire's radius (shared `safeTiles`).
 */
export function litSafeTiles(
  fires: readonly BuildingRow[],
  homeTiles: readonly HomeTileRow[],
  local: MapLocalTime,
): Set<HexKey> {
  const lit = fires.flatMap((row) => {
    const radius = safeRadiusOf(row);
    if (radius === null) return [];
    if (!hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).lit) return [];
    return [{ at: { q: row.q, r: row.r }, radius, homeTiles }];
  });
  return safeTiles(lit);
}
