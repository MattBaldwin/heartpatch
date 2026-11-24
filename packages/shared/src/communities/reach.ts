import { hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import { joinedLand, type ReachTile } from '../territory/reach.js';

// How a player reaches a Hollowed Community (#306). Pure, the trading posts'
// `postReach` shape: the server fills `CommunityView.reach` with it and the
// client explains it with the same code.

/** `CommunityView.reach` and `distance`: both null when the player owns no land here. */
export interface CommunityReach {
  readonly reach: 'touching' | 'away' | null;
  readonly distance: number | null;
}

/**
 * - `touching`: a village tile is in, or next to, the player's land joined to
 *   home (`joinedLand`: their supply line on a Wild Isle when `supplied` is
 *   passed, #863, else `connectedLand`), so they may explore it by day;
 * - `away`: it isn't, `distance` steps from their nearest owned tile to the
 *   nearest village tile (cut-off land counts, as for posts; at least 1).
 *   `away` at 1 always means land of theirs in or next to it is cut off.
 */
export function communityReach(
  villageTiles: readonly Hex[],
  tiles: readonly ReachTile[],
  userId: string,
  supplied?: ReadonlySet<HexKey> | null,
): CommunityReach {
  const connected = joinedLand(tiles, userId, supplied);
  const touching = villageTiles.some(
    (v) => connected.has(hexKey(v)) || hexNeighbors(v).some((n) => connected.has(hexKey(n))),
  );
  if (touching) return { reach: 'touching', distance: null };
  let distance = Infinity;
  for (const t of tiles) {
    if (t.ownerUserId !== userId) continue;
    for (const v of villageTiles) distance = Math.min(distance, hexDistance(t, v));
  }
  return distance === Infinity
    ? { reach: null, distance: null }
    : { reach: 'away', distance: Math.max(1, distance) };
}
