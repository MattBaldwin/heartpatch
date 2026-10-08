import { hexBfs, hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';

// Connected land and trading-post reach (#30, #269). Pure: the server decides
// with these and the client explains with the same code. `connectedLand` is
// the one BFS for "reached from home through my own land"; #199's homestead
// tiles reuse it rather than writing another.

/** The terrain id of a trading-post tile (stored in `tiles.terrain`, never renamed). */
export const TRADING_POST_TERRAIN = 'trading-post';

/** Is this tile a trading post? Posts are shared and never owned (owner decision 1 on #30). */
export function isTradingPost(tile: { readonly terrain: string }): boolean {
  return tile.terrain === TRADING_POST_TERRAIN;
}

/** What reach needs to know about a tile (`PublicTile` and the server's tile rows fit). */
export interface ReachTile extends Hex {
  readonly ownerUserId: string | null;
  readonly homeSlot: number | null;
}

/**
 * The player's land that's joined to their home: a BFS from their home tiles
 * (the Heart Seed and its ring) stepping only onto tiles they own. Land cut
 * off from home by a rival's capture isn't in it. Empty when they have no
 * home on this map.
 */
export function connectedLand(tiles: readonly ReachTile[], userId: string): Set<HexKey> {
  const mine = new Set(tiles.filter((t) => t.ownerUserId === userId).map(hexKey));
  const home = tiles.filter((t) => t.ownerUserId === userId && t.homeSlot !== null);
  return new Set(hexBfs(home, (h) => mine.has(hexKey(h))).keys());
}

/**
 * How a player reaches a trading post (owner decisions 1–3 on #30):
 * - `connected`: their land joined to home touches it, so no journey is needed;
 * - `journey`: it doesn't, and a journey's difficulty grows with `distance`,
 *   the steps from the post to their nearest owned tile (home ring included,
 *   cut-off land too, so a cut-off tile next to it is distance 1).
 * Null when they own no land on the map.
 */
export type PostReach =
  { readonly kind: 'connected' } | { readonly kind: 'journey'; readonly distance: number };

export function postReach(
  post: Hex,
  tiles: readonly ReachTile[],
  userId: string,
): PostReach | null {
  const connected = connectedLand(tiles, userId);
  if (hexNeighbors(post).some((n) => connected.has(hexKey(n)))) return { kind: 'connected' };
  let distance = Infinity;
  for (const t of tiles) {
    if (t.ownerUserId === userId) distance = Math.min(distance, hexDistance(t, post));
  }
  return distance === Infinity ? null : { kind: 'journey', distance };
}
