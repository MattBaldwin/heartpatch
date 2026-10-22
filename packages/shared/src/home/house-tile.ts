import { hex, hexAdd, hexKey, type Hex } from '../hex/index.js';
import { heartSeedOf } from '../hollow/index.js';

// Which home tile the Keeper's house stands on (#604, owner decision
// 2026-10-22): a ring tile of its own, which it fills like a habitat (#589),
// while the Heart Seed keeps the middle. Nothing is stored: it's the first
// ring tile, in `HOUSE_TILE_ORDER`, with no building on it, so the server
// (which refuses a building there) and the client (which draws the house
// there and offers it for nothing) always agree. A new home keeps the first
// tile in the order free forever; an older one whose first tile already has
// a building gets the next free one. With every ring tile built on, there's
// none (null): the house stays on the Heart Seed tile, as before.

/**
 * The ring tiles the house tries, in order, as steps from the Heart Seed:
 * back right, back left, right, left, front right, front left. The home
 * camera looks along +z (axial r = −1 is the back), so the house first sits
 * at the back, beside the Heart Seed rather than behind it.
 */
export const HOUSE_TILE_ORDER: readonly Hex[] = [
  hex(1, -1),
  hex(0, -1),
  hex(1, 0),
  hex(-1, 0),
  hex(0, 1),
  hex(-1, 1),
]; // TUNE: changing it moves every house

/**
 * The house's tile for a home: its tiles (the Heart Seed's among them) and
 * the tiles its buildings stand on (any of mine; ones off home are ignored).
 * Null when the home has no middle or no free ring tile: the house stays on
 * the Heart Seed tile.
 */
export function houseTile(tiles: readonly Hex[], buildingTiles: readonly Hex[]): Hex | null {
  const seed = heartSeedOf(tiles);
  if (!seed) return null;
  const home = new Set(tiles.map((t) => hexKey(t)));
  const built = new Set(buildingTiles.map((t) => hexKey(t)));
  for (const step of HOUSE_TILE_ORDER) {
    const at = hexAdd(seed, step);
    if (home.has(hexKey(at)) && !built.has(hexKey(at))) return at;
  }
  return null;
}
