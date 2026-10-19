import { hexDistance, hexKey, hexNeighbors, type Hex } from '../hex/index.js';
import { connectedLand, type ReachTile } from '../territory/reach.js';

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
 *   home (`connectedLand`), so they may explore it by day;
 * - `away`: it isn't, `distance` steps from their nearest owned tile to the
 *   nearest village tile (cut-off land counts, as for posts; at least 1).
 */
export function communityReach(
  villageTiles: readonly Hex[],
  tiles: readonly ReachTile[],
  userId: string,
): CommunityReach {
  const connected = connectedLand(tiles, userId);
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
