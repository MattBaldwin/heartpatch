import {
  hexToWorld,
  type Hex,
  type MapView,
  type PublicFence,
  type PublicTile,
} from '@heartpatch/shared';

// Where fence segments stand on the map (#203, #204). Edge `e` of a tile is
// the side it shares with its neighbour in `HEX_DIRECTIONS[e]`; on the ground
// that neighbour lies at 60° × e from +x (east), anticlockwise seen from
// above (+z is north). Pointy-top hexes have corners at 30° + 60° × k, so edge
// e runs between the corners at 60e − 30° and 60e + 30°. Each segment is
// pulled in toward its tile's middle a little (`FENCE_INSET`), so a
// neighbour's fence on the same edge stands on its own side, and segments on
// one tile meet at the pulled-in corners: a border reads as one fence line.

/** How far toward the middle a segment stands, as a share of the hex size. TUNE */
export const FENCE_INSET = 0.88;

/** Every segment's length on the map: an edge's, pulled in. */
export function fenceLength(size: number): number {
  return size * FENCE_INSET;
}

/** Where a segment on `edge` of `tile` stands: its middle, and its yaw (Babylon's `rotation.y`). */
export function edgeTransform(
  tile: Hex,
  edge: number,
  size: number,
): { x: number; z: number; yaw: number } {
  const centre = hexToWorld(tile, size);
  const out = (Math.PI / 3) * edge;
  // The middle of the edge is the apothem away; pulled in with the corners.
  const reach = size * FENCE_INSET * (Math.sqrt(3) / 2);
  const x = centre.x + Math.cos(out) * reach;
  const z = centre.z + Math.sin(out) * reach;
  // Local +x runs along the edge (90° on from outward); Babylon's RotationY
  // turns +x to (cos a, −sin a), so a = atan2(−tz, tx).
  const tx = Math.cos(out + Math.PI / 2);
  const tz = Math.sin(out + Math.PI / 2);
  return { x, z, yaw: Math.atan2(-tz, tx) };
}

/** One segment to draw. */
export interface FencePlacement {
  readonly tile: PublicTile;
  readonly fence: PublicFence;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Every fence segment on the map, where it stands. */
export function fencePlacements(view: Pick<MapView, 'tiles'>, size: number): FencePlacement[] {
  return view.tiles.flatMap((tile) =>
    (tile.fences ?? []).map((fence) => ({ tile, fence, ...edgeTransform(tile, fence.edge, size) })),
  );
}
