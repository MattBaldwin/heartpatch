import { TERRAINS } from '../data/terrains.js';
import { hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import {
  buildsOnPatchType,
  WILD_ISLE_BUILDING_KINDS,
  type Building,
  type NeedsWaterSchema,
} from '../schemas/data/buildings.js';
import { isBuildable, type HomeBaseRules } from '../schemas/data/home-base.js';
import type { WaterKind } from '../schemas/data/terrains.js';
import type { PatchType } from '../patch-types/patch-type.js';
import type { z } from 'zod';

// Wild Isle water works (#621 W1-8): where a works, canal or shelter may
// stand (`needsWater`, an edge-to-edge neighbour), and how far a chain of
// Canals carries water inland. Pure: the server's place check and the
// client's Build sheet read the same rules.

/** Water a building can need next door: a water terrain's kind, or a Canal. */
export type NeedsWater = z.infer<typeof NeedsWaterSchema>;

const WATER_OF = new Map<string, WaterKind>(
  TERRAINS.flatMap((t) => (t.water ? [[t.id, t.water] as const] : [])),
);

/** A terrain id's water kind (`deep`, `river`, `lake`), or null for land. */
export function waterKindOf(terrain: string): WaterKind | null {
  return WATER_OF.get(terrain) ?? null;
}

/** A tile as the water rules need it: where, and what terrain. */
export interface WaterWorksTile extends Hex {
  readonly terrain: string;
}

/**
 * How many canals from the water each canal is (`canalReach`): a canal next
 * to water is 1, one next to that 2, and so on, the fewest steps winning. A
 * canal past `maxRun`, or in a chain that never touches water, carries none
 * and is left out.
 */
export function canalReach(
  tiles: readonly WaterWorksTile[],
  canals: readonly Hex[],
  maxRun: number,
): Map<HexKey, number> {
  const terrain = new Map(tiles.map((t) => [hexKey(t), t.terrain]));
  const at = new Set(canals.map(hexKey));
  const touchesWater = (h: Hex) =>
    hexNeighbors(h).some((n) => waterKindOf(terrain.get(hexKey(n)) ?? '') !== null);
  const reach = new Map<HexKey, number>();
  let frontier = canals.filter(touchesWater);
  for (const c of frontier) reach.set(hexKey(c), 1);
  for (let run = 2; run <= maxRun && frontier.length > 0; run++) {
    const next: Hex[] = [];
    for (const c of frontier) {
      for (const n of hexNeighbors(c)) {
        const k = hexKey(n);
        if (!at.has(k) || reach.has(k)) continue;
        reach.set(k, run);
        next.push(n);
      }
    }
    frontier = next;
  }
  return reach;
}

/**
 * Does `tile` have the water a building needs next door: a neighbour whose
 * terrain is one of `needsWater`'s kinds, or (with `canal` in it) a canal
 * that carries water (`canalReach`)? Nothing needed: always.
 */
export function hasWaterNextDoor(
  tile: Hex,
  tiles: readonly WaterWorksTile[],
  canals: readonly Hex[],
  needsWater: readonly NeedsWater[] | undefined,
  maxRun: number,
): boolean {
  if (!needsWater || needsWater.length === 0) return true;
  const terrain = new Map(tiles.map((t) => [hexKey(t), t.terrain]));
  const kinds = new Set<string>(needsWater);
  const near = hexNeighbors(tile);
  if (near.some((n) => kinds.has(waterKindOf(terrain.get(hexKey(n)) ?? '') ?? ''))) return true;
  if (!kinds.has('canal')) return false;
  const reach = canalReach(tiles, canals, maxRun);
  return near.some((n) => reach.has(hexKey(n)));
}

/**
 * May a new canal stand on `tile`: next to water, or next to a canal that
 * carries water with room for one more in its run (`maxRun`)?
 */
export function canalFits(
  tile: Hex,
  tiles: readonly WaterWorksTile[],
  canals: readonly Hex[],
  maxRun: number,
): boolean {
  const reach = canalReach(tiles, [...canals, tile], maxRun);
  return reach.has(hexKey(tile));
}

/** Why a building is held back from a tile for want of water, for its kid line. */
export type WaterRefusal = 'water' | 'river' | 'river-or-lake' | 'coast' | 'canal';

/**
 * Which held-back line a building's water need reads as (plan §8, revision
 * 1 §8): a canal's own; only the sea ("Only on the coast"); only a river
 * ("Needs the river"); a river or a lake (the River Well); else any water
 * next door.
 */
export function waterRefusalOf(
  building: Pick<Building, 'kind'> & { needsWater?: readonly NeedsWater[] },
): WaterRefusal {
  if (building.kind === 'canal') return 'canal';
  const needs = new Set(building.needsWater ?? []);
  const is = (...kinds: NeedsWater[]) =>
    needs.size === kinds.length && kinds.every((k) => needs.has(k));
  if (is('deep')) return 'coast';
  if (is('river')) return 'river';
  if (is('river', 'lake')) return 'river-or-lake';
  return 'water';
}

/** The Wild Isle kinds placed through `isBuildableOn` (travel's Waystation still waits). */
const PLACED_BY_PATCH: readonly Building['kind'][] = WILD_ISLE_BUILDING_KINDS;

/**
 * Can this building go up on a patch of this type? Today's buildable kinds
 * (`isBuildable`), or a Wild Isle kind (#621) its `patchTypes` allow there,
 * except the Waystation, whose rules are still to come. The Wild Isle kinds
 * stay out of `HOME_BASE_RULES.buildableKinds` (the client's exhaustive
 * kind names), so a Cozy Patch's list is today's, byte for byte.
 */
export function isBuildableOn(
  rules: HomeBaseRules,
  building: Building,
  patchType: PatchType,
): boolean {
  if (isBuildable(rules, building, patchType)) return true;
  if (!PLACED_BY_PATCH.includes(building.kind) || building.patchTypes === undefined) return false;
  if (building.kind === 'travel' && building.role === 'waystation') return false;
  return buildsOnPatchType(building, patchType);
}
