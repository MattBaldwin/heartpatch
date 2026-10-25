import {
  HEX_DIRECTIONS,
  hexKey,
  hexNeighbors,
  hexToWorld,
  type Hex,
  type HexKey,
} from '@heartpatch/shared';

// Where a Wild Isle's roads draw (#621 W1-6). A road is a tile attribute with
// a level; on the map it's a small round hub in the tile's middle plus one arm
// to each side that joins another road, bridge or dock. Which sides join is a
// 6-bit mask (bit i is `HEX_DIRECTIONS[i]`), so a tile's whole look is two
// numbers (level, mask) and the layer can draw every road with a few thin
// instances. Pure, so the layout is unit-tested without a GPU.

/** A road as the layout needs it. */
export interface RoadTile extends Hex {
  readonly level: number;
}

/** One road tile ready to draw: its level, and which of its six sides join on. */
export interface RoadPiece extends Hex {
  readonly level: number;
  readonly mask: number;
}

/** All six sides joined. */
export const FULL_MASK = 0b111111;

/**
 * Which of `hex`'s six sides face a tile in `joins`: bit i is set when the
 * neighbour in `HEX_DIRECTIONS[i]` joins.
 */
export function neighbourMask(hex: Hex, joins: ReadonlySet<HexKey>): number {
  let mask = 0;
  hexNeighbors(hex).forEach((n, i) => {
    if (joins.has(hexKey(n))) mask |= 1 << i;
  });
  return mask;
}

/** The sides a mask joins, 0–5 in `HEX_DIRECTIONS` order. */
export function maskSides(mask: number): number[] {
  return HEX_DIRECTIONS.map((_, i) => i).filter((i) => (mask & (1 << i)) !== 0);
}

/**
 * Every road with its mask. `joins` is every tile a road runs into: all the
 * road tiles, plus bridges and docks, which a road meets end on. A road
 * level outside 1–3 is drawn as the nearest one.
 */
export function roadPieces(
  roads: readonly RoadTile[],
  extraJoins: Iterable<HexKey> = [],
): RoadPiece[] {
  const joins = new Set<HexKey>(extraJoins);
  for (const road of roads) joins.add(hexKey(road));
  return roads.map((road) => ({
    q: road.q,
    r: road.r,
    level: Math.max(1, Math.min(3, Math.round(road.level))),
    mask: neighbourMask(road, joins),
  }));
}

/**
 * The turn (radians about the up axis) that points an arm modelled along +x
 * towards side `side`. Babylon's yaw takes +x to `(cos θ, −sin θ)` on (x, z).
 */
export function armYaw(side: number): number {
  const d = HEX_DIRECTIONS[side];
  if (!d) throw new RangeError(`armYaw(): no side ${String(side)}`);
  const w = hexToWorld(d, 1);
  return Math.atan2(-w.z, w.x);
}

/**
 * Which way a bridge on `hex` runs: along the line between its two
 * opposite sides that face land (a river's banks), as the yaw of a model
 * that lies along +x. With no opposite pair it follows the first land side;
 * with no land side it keeps the default.
 */
export function bridgeYaw(hex: Hex, land: ReadonlySet<HexKey>): number {
  const mask = neighbourMask(hex, land);
  const sides = maskSides(mask);
  const opposite = sides.find((s) => s < 3 && (mask & (1 << (s + 3))) !== 0);
  const side = opposite ?? sides[0];
  return side === undefined ? 0 : armYaw(side);
}
