import {
  hexKey,
  hexToWorld,
  HEX_DIRECTIONS,
  isGenerator,
  needsPower,
  type HexKey,
  type LineKind,
  type PublicLine,
  type PublicTile,
} from '@heartpatch/shared';
import { armYaw, maskSides, neighbourMask } from '../roads/road-layout.js';

// Where a Clockwork Isle's wires and rails draw (#874 C4). A line is a tile
// attribute like a road (owner answer Q3), so it reuses the roads' join
// masks: bit i is set when the neighbour in `HEX_DIRECTIONS[i]` joins. A
// wire joins its owner's wires and the tiles of its owner's Windmills and
// machines; a rail joins its owner's rails and Rail Depots. Pure, so the
// layout is unit-tested without a GPU.

/** A line as the layer draws it: where, its mask, and (wires) whether it carries power. */
export interface LinePiece {
  readonly q: number;
  readonly r: number;
  readonly kind: LineKind;
  readonly level: number;
  readonly mask: number;
  /** Wires: joined to one of its owner's Windmills (the server's view). Rails: false. */
  readonly lit: boolean;
  /** A building stands in the tile's middle, so the line keeps to a ring round it. */
  readonly ringed: boolean;
}

/** The Rail Depot's content id: a rail runs into it end on. */
export const DEPOT_ID = 'rail-depot';

/** Does a wire meet this building (a Windmill or a machine that needs power)? */
const wireMeets = (buildingId: string): boolean =>
  isGenerator(buildingId) || needsPower(buildingId);

/** Does a rail meet this building (the Rail Depot)? */
const railMeets = (buildingId: string): boolean => buildingId === DEPOT_ID;

/**
 * The tiles a line of `kind` owned by `owner` runs into besides its own
 * kind: the owner's tiles with a building it meets end on.
 */
export function lineJoins(tiles: Iterable<PublicTile>, kind: LineKind, owner: string): Set<HexKey> {
  const meets = kind === 'wire' ? wireMeets : railMeets;
  const joins = new Set<HexKey>();
  for (const tile of tiles) {
    if (tile.ownerUserId !== owner) continue;
    if (tile.buildings.some((b) => meets(b.buildingId))) joins.add(hexKey(tile));
  }
  return joins;
}

/**
 * Every line on a known tile, with its mask. A line joins its owner's lines
 * of the same kind next door and the buildings it meets (`lineJoins`); two
 * Keepers' wires never join, as one's power never reaches the other.
 */
export function linePieces(
  lines: readonly PublicLine[],
  tiles: ReadonlyMap<HexKey, PublicTile>,
): LinePiece[] {
  const joinsOf = new Map<string, Set<HexKey>>();
  const keyOf = (kind: LineKind, owner: string) => `${kind}|${owner}`;
  for (const line of lines) {
    const key = keyOf(line.kind, line.ownerUserId);
    let joins = joinsOf.get(key);
    if (!joins) {
      joins = lineJoins(tiles.values(), line.kind, line.ownerUserId);
      joinsOf.set(key, joins);
    }
    joins.add(hexKey(line));
  }
  return lines.flatMap((line) => {
    const tile = tiles.get(hexKey(line));
    if (!tile) return [];
    const joins = joinsOf.get(keyOf(line.kind, line.ownerUserId)) ?? new Set<HexKey>();
    return [
      {
        q: line.q,
        r: line.r,
        kind: line.kind,
        level: line.level,
        mask: neighbourMask(line, joins),
        lit: line.kind === 'wire' && line.powered === true,
        ringed: tile.buildings.length > 0,
      },
    ];
  });
}

/**
 * The sides a rail draws arms to: its joined sides, and a lone rail or a
 * rail's end runs straight on through the opposite side, so every rail reads
 * as a bit of track (never a lone dot).
 */
export function railSides(mask: number): number[] {
  const sides = maskSides(mask);
  if (sides.length === 0) return [0, 3];
  const first = sides[0];
  if (sides.length === 1 && first !== undefined) return [first, (first + 3) % 6];
  return sides;
}

/** How far it is from a tile's middle to the middle of the side it shares with a neighbour. */
export function sideDistance(size: number): number {
  const d = HEX_DIRECTIONS[0];
  if (!d) return 0;
  const w = hexToWorld(d, size);
  return Math.hypot(w.x, w.z) / 2;
}

/** One arm as the layer places it: which way it turns, where it starts out from the middle, how long. */
export interface ArmPlacement {
  readonly side: number;
  readonly yaw: number;
  /** Distance from the tile's middle where the arm starts (a ring round a building, or 0). */
  readonly from: number;
  /** How much of the full arm (middle to side) it covers: `(side - from) / side`. */
  readonly length: number;
}

/** Where each of `sides`' arms goes on a tile, given the ring (as a share of the side distance) on a ringed tile. */
export function armPlacements(
  sides: readonly number[],
  ringed: boolean,
  ring: number,
  size: number,
): ArmPlacement[] {
  const full = sideDistance(size);
  const from = ringed ? full * ring : 0;
  return sides.map((side) => ({
    side,
    yaw: armYaw(side),
    from,
    length: full > 0 ? (full - from) / full : 0,
  }));
}
