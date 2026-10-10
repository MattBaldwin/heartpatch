import { HEX_DIRECTIONS, hexToWorld, type Hex } from '../hex/index.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import {
  MAX_SEARCH_SPOTS,
  type ExploreRules,
  type ExploreTerrain,
  type SearchSpotKind,
  type ToolId,
} from '../schemas/data/explore.js';

export * from './homestead.js';
export * from './sky.js';

// Exploring your land (#199). Each explorable tile has a fixed, finite set
// of search spots, a pure function of the map seed, the tile, its terrain
// and its layout version (`exploreLayout`), so nothing about the layout is stored: only which
// spots a player has searched (a bitmask, `tile_explore.searched`). Buildings
// aren't an input: spots keep clear of all seven building spots, used or
// not, so putting up or taking down a building never moves one. The map
// seed is server-only, so the server sends the list to the client.

/** One place to search on a tile. */
export interface SearchSpot {
  /** Its bit in the player's progress mask, 0 first. */
  readonly index: number;
  readonly kind: string;
  /** The tool it needs, or null for hands. */
  readonly tool: ToolId | null;
  /** Where it is, in tile-local units (`hexToWorld` at size 1: the tile's corner is 1 away). */
  readonly x: number;
  readonly z: number;
}

/** A tile as the generator sees it. */
export interface ExploreTile extends Hex {
  readonly terrain: string;
}

/** Placement tries per spot before the generator settles for fewer spots. */
const TRIES_PER_SPOT = 64;

const SQRT3 = Math.sqrt(3);

/** The terrain's explore entry, or undefined when it can't be explored (Juniper's Gap). */
export function exploreTerrain(terrain: string, rules: ExploreRules): ExploreTerrain | undefined {
  return rules.terrains.find((t) => t.terrain === terrain);
}

/**
 * The layout version a terrain's spots are made under (#335): its own when it
 * has one, else the rules'. Saved progress made under another is stale.
 */
export function exploreLayout(terrain: string, rules: ExploreRules): number {
  return exploreTerrain(terrain, rules)?.layout ?? rules.layout;
}

/** Can tiles of this terrain be explored at all? */
export function isExplorable(terrain: string, rules: ExploreRules): boolean {
  return exploreTerrain(terrain, rules) !== undefined;
}

function kindOf(id: string, rules: ExploreRules): SearchSpotKind {
  const kind = rules.spotKinds.find((k) => k.id === id);
  if (!kind) throw new Error(`unknown search-spot kind "${id}"`);
  return kind;
}

/**
 * Every tool a tile of this terrain needs to be fully explored, in tool-row
 * order. The generator gives every tile one spot per tool its kit uses, so
 * this is the same for every tile of a terrain. Empty: hands only.
 */
export function exploreNeeds(terrain: string, rules: ExploreRules): ToolId[] {
  const entry = exploreTerrain(terrain, rules);
  if (!entry) return [];
  const needed = new Set(entry.kinds.map((k) => kindOf(k.kind, rules).tool));
  return rules.tools.map((t) => t.id).filter((id) => needed.has(id));
}

/** Is a tile-local point inside the hex, at least `margin` in from its edge? */
function insideTile(x: number, z: number, margin: number): boolean {
  const r = 1 - margin;
  const ax = Math.abs(x);
  return ax <= (SQRT3 / 2) * r && ax / SQRT3 + Math.abs(z) <= r;
}

/** Where the seven building spots sit inside a tile (the middle, then `HEX_DIRECTIONS`). */
function buildingSpots(rules: ExploreRules): { x: number; z: number }[] {
  const scale = rules.placement.buildingSpotScale;
  return [{ q: 0, r: 0 }, ...HEX_DIRECTIONS].map((offset) => hexToWorld(offset, scale));
}

/** Rounded to thousandths, so a layout reads the same in JSON everywhere. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000 + 0;
}

/**
 * The kinds a tile gets, in placement order: first one spot per tool group
 * its kit uses (hands, then each tool, in kit order), so a tile always needs
 * every tool its terrain lists, then weighted picks from the whole kit.
 */
function pickKinds(entry: ExploreTerrain, count: number, rng: Rng, rules: ExploreRules): string[] {
  const groups: (ToolId | null)[] = [];
  for (const k of entry.kinds) {
    const tool = kindOf(k.kind, rules).tool;
    if (!groups.includes(tool)) groups.push(tool);
  }
  const picked = groups.map(
    (tool) => rng.weighted(entry.kinds.filter((k) => kindOf(k.kind, rules).tool === tool)).kind,
  );
  while (picked.length < count) picked.push(rng.weighted(entry.kinds).kind);
  return picked;
}

/**
 * A tile's search spots, or null when its terrain can't be explored. The
 * same inputs always give the same spots (tech spec §8). Spots sit inside
 * the tile, clear of every building spot and of each other; if a crowded
 * layout can't fit one, the tile has fewer (never fewer than the terrain's
 * `spots.min` with today's data, which the tests check).
 */
export function searchSpots(
  mapSeed: Seed,
  tile: ExploreTile,
  rules: ExploreRules,
): SearchSpot[] | null {
  const entry = exploreTerrain(tile.terrain, rules);
  if (!entry) return null;
  const rng = Rng.fromSeed(
    deriveSeed(mapSeed, 'explore', tile.q, tile.r, entry.layout ?? rules.layout),
  );
  const count = Math.min(rng.int(entry.spots.min, entry.spots.max), MAX_SEARCH_SPOTS);
  const kinds = pickKinds(entry, count, rng, rules);

  const { buildingClearance, minGap, edgeMargin } = rules.placement;
  const blocked = buildingSpots(rules);
  const spots: SearchSpot[] = [];
  for (const kind of kinds) {
    for (let attempt = 0; attempt < TRIES_PER_SPOT; attempt++) {
      const x = round((rng.next() * 2 - 1) * (SQRT3 / 2));
      const z = round(rng.next() * 2 - 1);
      if (!insideTile(x, z, edgeMargin)) continue;
      const far = (p: { x: number; z: number }, gap: number) =>
        (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) >= gap * gap;
      if (!blocked.every((b) => far(b, buildingClearance))) continue;
      if (!spots.every((s) => far(s, minGap))) continue;
      spots.push({ index: spots.length, kind, tool: kindOf(kind, rules).tool, x, z });
      break;
    }
  }
  return spots;
}

/**
 * What one finished cycle gives on a joined homestead, a squishy's or the
 * Keeper's (owner decision 2026-10-07: yield, not speed): the usual
 * `quantity` scaled by `yieldPercent` (rounded up, whole-number maths) plus
 * `yieldPlus`. A paused homestead gives nothing, which the caller handles.
 */
export function homesteadQuantity(
  quantity: number,
  rules: Pick<ExploreRules, 'homestead'>,
): number {
  const { yieldPercent, yieldPlus } = rules.homestead;
  return Math.floor((quantity * yieldPercent + 99) / 100) + yieldPlus;
}

// Progress is one bit per spot index (`tile_explore.searched`).

/** Has the spot at `index` been searched? */
export function isSearched(mask: number, index: number): boolean {
  return index >= 0 && index < MAX_SEARCH_SPOTS && (mask & (1 << index)) !== 0;
}

/** The mask with `index` searched. */
export function withSearched(mask: number, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_SEARCH_SPOTS) {
    throw new RangeError(`withSearched(): no spot ${String(index)}`);
  }
  return mask | (1 << index);
}

/** How many of a tile's spots have been searched. */
export function searchedCount(mask: number, spotCount: number): number {
  let n = 0;
  for (let i = 0; i < spotCount; i++) if (isSearched(mask, i)) n++;
  return n;
}

/** Every spot searched: the tile is fully explored ✨. */
export function isFullyExplored(mask: number, spotCount: number): boolean {
  return spotCount > 0 && searchedCount(mask, spotCount) === spotCount;
}
