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

/** Room kept between two flags (#306), so pills never touch. TUNE. */
export const FLAG_GAP_PX = 4;
/** How many rows up or down, and half-widths sideways, a crowded flag may move from its tile. TUNE. */
const STACK = { rows: 3, sideways: 2 };

/**
 * Like `flagSpot`, but a flag whose spots over and under its tile are taken
 * (by a flag placed before it, the patch name, the night chips) looks for the
 * nearest free one close by instead of hiding (#306): a row further up or
 * down, then nudged sideways by half its width, nearest first. Hidden only
 * when its tile is off screen or nothing near is free.
 */
export function freeFlagSpot(
  tile: Rect | null,
  flag: { width: number; height: number },
  room: FlagRoom,
): { x: number; y: number } | null {
  const spot = flagSpot(tile, flag, room);
  if (spot || tile === null) return spot;
  const base = flagSpot(tile, flag, { ...room, covers: [] });
  if (base === null) return null;
  const half = flag.width / 2;
  const under = Math.round(tile.y + tile.height + flag.height);
  const step = flag.height + FLAG_GAP_PX;
  const tries: { x: number; y: number; cost: number }[] = [];
  for (let row = 0; row <= STACK.rows; row++) {
    for (let side = -STACK.sideways; side <= STACK.sideways; side++) {
      // Whole pixels, and never a half-pixel past either side.
      const x = Math.min(
        Math.max(Math.round(base.x + side * half), Math.ceil(half)),
        Math.floor(room.width - half),
      );
      // A row up or down before a long slide sideways.
      const cost = row * 2 + Math.abs(side) * 1.5;
      tries.push({ x, y: base.y - row * step, cost }, { x, y: under + row * step, cost: cost + 1 });
    }
  }
  tries.sort((a, b) => a.cost - b.cost);
  for (const at of tries) {
    const box = { x: at.x - half, y: at.y - flag.height, width: flag.width, height: flag.height };
    if (box.y < room.top || at.y > room.height) continue;
    if (room.covers.some((cover) => intersects(box, cover))) continue;
    return { x: at.x, y: at.y };
  }
  return null;
}

/**
 * Places flags in order, each keeping clear of `room.covers` and of every
 * flag placed before it (with `FLAG_GAP_PX` between), so no two overlap
 * (#306). Null for a flag that hides.
 */
export function placeFlags(
  flags: readonly { tile: Rect | null; size: { width: number; height: number } }[],
  room: FlagRoom,
): ({ x: number; y: number } | null)[] {
  const covers = [...room.covers];
  const next = { ...room, covers };
  return flags.map(({ tile, size }) => {
    const spot = freeFlagSpot(tile, size, next);
    if (spot) {
      covers.push({
        x: spot.x - size.width / 2 - FLAG_GAP_PX,
        y: spot.y - size.height - FLAG_GAP_PX,
        width: size.width + FLAG_GAP_PX * 2,
        height: size.height + FLAG_GAP_PX * 2,
      });
    }
    return spot;
  });
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
