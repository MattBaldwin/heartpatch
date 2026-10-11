import { hexToWorld, type Hex } from '@heartpatch/shared';

// Where a tap lands on a tile being built on (#371): each of the six edges
// owns the 60° wedge facing it (edge `e` faces 60° × e from east, the same
// way `edgeTransform` lays fences), and the middle belongs to the tile's
// one spot. Wedges are big, so every edge is an easy 44 pt target.

/** How far from the middle a tap counts as the middle, as a share of the hex size. TUNE */
export const CENTRE_REACH = 0.4;

/** How far past the rim a tap still counts as the tile's edge, as a share of the hex size. TUNE */
export const EDGE_REACH = 1.15;

export type BuildAreaHit = { readonly edge: number } | 'centre';

/** What a ground point `p` is on for `tile`: an edge, the middle, or neither. */
export function buildAreaAt(
  tile: Hex,
  p: { x: number; z: number },
  size: number,
): BuildAreaHit | null {
  const c = hexToWorld(tile, size);
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = Math.hypot(dx, dz);
  if (d > size * EDGE_REACH) return null;
  if (d < size * CENTRE_REACH) return 'centre';
  const turn = Math.PI / 3;
  const angle = (Math.atan2(dz, dx) + Math.PI * 2) % (Math.PI * 2);
  return { edge: Math.round(angle / turn) % 6 };
}
