// Where a trading post's flag sits on screen (#269, #310). Pure, so every
// edge is unit-tested; post-flags.ts measures and calls it once per frame.

/** A box on screen in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlagRoom {
  /** The viewport's size. */
  width: number;
  height: number;
  /** The bottom of the corner buttons (the top bar): no flag goes above it. */
  top: number;
}

/**
 * The flag's anchor (its bottom middle) over its tile, or null to hide it.
 * Sideways a flag keeps to the screen, so a post near an edge stays named.
 * Upward it keeps below the top bar, and once its tile is mostly under the
 * bar it hides: pinned to the very top it would show between the corner
 * buttons, and on a phone with a sheet open that thin strip is all the map
 * that's left (#310).
 */
export function flagSpot(
  tile: Box | null,
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
  return {
    x: Math.round(Math.min(Math.max(tile.x + tile.width / 2, half), room.width - half)),
    y: Math.round(Math.max(tile.y, room.top + flag.height)),
  };
}
