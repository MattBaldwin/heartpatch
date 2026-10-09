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
  /** What's drawn over the map (the top bar, the patch name, open sheets): a flag never peeks out from under one. */
  covers: readonly Box[];
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The flag's anchor (its bottom middle) over its tile, or null to hide it.
 * Sideways a flag keeps to the screen, so a post near an edge stays named.
 * Upward it keeps below the top bar, and once its tile is mostly under the
 * bar it hides: pinned to the very top it would show between the corner
 * buttons, and on a phone with a sheet open that thin strip is all the map
 * that's left (#310). A flag that would touch anything drawn over the map
 * hides too, rather than show a cut-off sliver beside it.
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
  const x = Math.round(Math.min(Math.max(tile.x + tile.width / 2, half), room.width - half));
  const y = Math.round(Math.max(tile.y, room.top + flag.height));
  const box = { x: x - half, y: y - flag.height, width: flag.width, height: flag.height };
  return room.covers.some((cover) => overlaps(box, cover)) ? null : { x, y };
}
