import { TERRAINS } from '../data/terrains.js';
import { hexBfs, hexFromKey, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import { isWater } from '../schemas/data/terrains.js';

// Wild Isle lakes and the ferry (#621 W1-5b, revision 1 Q2). A lake body is
// the `wild-lake` tiles joined edge to edge; a river or the ocean between
// two lakes keeps them two bodies. A ferry dock on a homestead touching a
// lake reaches the land round that lake within `TRAVEL_RULES.ferry.range`
// water steps. Pure: `supplyMap` and the server's dock checks use the same code.

const LAKES = new Set(TERRAINS.filter((t) => t.water === 'lake').map((t) => t.id));
const WATER = new Set(TERRAINS.filter((t) => isWater(t)).map((t) => t.id));

/** Is this terrain id a Wild Isle lake (`water: 'lake'`)? Cozy's claimable `lake` isn't. */
export function isLakeTerrain(terrain: string): boolean {
  return LAKES.has(terrain);
}

/** A tile as the lake rules need it: where, and what terrain. */
export interface WaterTile extends Hex {
  readonly terrain: string;
}

/**
 * Every lake tile's body: the smallest `HexKey` of the lake tiles joined to
 * it edge to edge, so the id doesn't depend on the tiles' order.
 */
export function lakeBodies(tiles: readonly WaterTile[]): Map<HexKey, HexKey> {
  const lakes = new Set(tiles.filter((t) => isLakeTerrain(t.terrain)).map(hexKey));
  const bodies = new Map<HexKey, HexKey>();
  for (const t of tiles) {
    const key = hexKey(t);
    if (!lakes.has(key) || bodies.has(key)) continue;
    const body = [...hexBfs([t], (h) => lakes.has(hexKey(h))).keys()];
    const id = body.reduce((a, b) => (b < a ? b : a));
    for (const k of body) bodies.set(k, id);
  }
  return bodies;
}

/** The lake bodies a tile touches (`lakeBodies` ids), sorted. */
export function lakesTouching(bodies: ReadonlyMap<HexKey, HexKey>, hex: Hex): HexKey[] {
  const ids = new Set(hexNeighbors(hex).flatMap((n) => bodies.get(hexKey(n)) ?? []));
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Where a dock at `dock` ferries to: each land tile touching a lake tile
 * within `range` water steps (the lake tile next to the dock is step 1),
 * with the fewest steps to it. Only the lakes the dock touches; the dock's
 * own tile isn't in it. Empty when it touches no lake.
 */
export function ferryShore(
  tiles: readonly WaterTile[],
  dock: Hex,
  range: number,
): Map<HexKey, number> {
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  const isLake = (h: Hex) => {
    const t = byKey.get(hexKey(h));
    return t !== undefined && isLakeTerrain(t.terrain);
  };
  const shore = new Map<HexKey, number>();
  const starts = hexNeighbors(dock).filter(isLake);
  if (starts.length === 0 || range < 1) return shore;
  const dockKey = hexKey(dock);
  for (const [key, distance] of hexBfs(starts, isLake)) {
    const steps = distance + 1;
    if (steps > range) continue;
    for (const n of hexNeighbors(hexFromKey(key))) {
      const k = hexKey(n);
      const t = byKey.get(k);
      if (k === dockKey || t === undefined || WATER.has(t.terrain)) continue;
      shore.set(k, Math.min(shore.get(k) ?? Infinity, steps));
    }
  }
  return shore;
}
