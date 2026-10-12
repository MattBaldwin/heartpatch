// Where a trading post's flag sits on screen (#269, #310). Pure, so every
// edge is unit-tested; post-flags.ts measures and calls it once per frame.

import { intersects, type Rect } from '../ui/geometry.js';

export interface FlagRoom {
  /** The viewport's size. */
  width: number;
  height: number;
  /** The bottom of the corner buttons (the top bar): no flag goes above it. */
  top: number;
  /**
   * What a flag must not touch: what's drawn over the map (the top bar, the
   * patch name, the tray handles, open sheets), which it would peek out from
   * under, and my Keeper, which it would hide (#426).
   */
  covers: readonly Rect[];
}

/**
 * The flag's anchor (its bottom middle) over its tile, or null to hide it.
 * Sideways a flag keeps to the screen, so a post near an edge stays named.
 * Upward it keeps below the top bar, and once its tile is mostly under the
 * bar it hides: pinned to the very top it would show between the corner
 * buttons, and on a phone with a sheet open that thin strip is all the map
 * that's left (#310). A flag that would touch anything in `covers` hangs
 * under its tile instead, and hides if that touches one too, rather than show
 * a cut-off sliver: on a small phone the tray handles leave too little room
 * between them for a flag to slide past (#426).
 */
export function flagSpot(
  tile: Rect | null,
  flag: { width: number; height: number },
  room: FlagRoom,
): { x: number; y: number } | null {
  if (
    tile === null ||
    tile.x + tile.width <= 0 ||
    tile.x >= room.width ||
    tile.y + tile.height / 2 <= room.top ||
    tile.y >= room.height
  ) {
    return null;
  }
  const half = flag.width / 2;
  const x = Math.round(Math.min(Math.max(tile.x + tile.width / 2, half), room.width - half));
  const over = Math.round(Math.max(tile.y, room.top + flag.height));
  const under = Math.round(tile.y + tile.height + flag.height);
  const clear = (y: number) => {
    const box = { x: x - half, y: y - flag.height, width: flag.width, height: flag.height };
    return y <= room.height && !room.covers.some((cover) => intersects(box, cover));
  };
  if (clear(over)) return { x, y: over };
  return clear(under) ? { x, y: under } : null;
}

/**
 * Where my Keeper reaches on screen past my Heart Seed's tile, in tile sizes:
 * up (they stand tall) and right (they stand near the seed's right rim,
 * `KEEPER_PLACES.map.offset`). TUNE.
 */
const KEEPER_REACH = { up: 1, right: 0.5 };

/** What a flag keeps clear of so it never covers my Keeper (#426), from my Heart Seed's tile on screen. */
export function keeperCover(seed: Rect): Rect {
  const up = seed.height * KEEPER_REACH.up;
  return {
    x: seed.x,
    y: seed.y - up,
    width: seed.width * (1 + KEEPER_REACH.right),
    height: seed.height + up,
  };
}
