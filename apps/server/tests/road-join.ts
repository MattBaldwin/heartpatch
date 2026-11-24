// Test helper (#863): on a Wild Isle, land a road joins to home reaches a
// Hollowed village. Cuts a player's path to a village they touch and finds
// where a Paved road of theirs joins it back up, with the shared rules.
import { communityReach, supplyMap, TRAVEL_RULES, type Hex } from '@heartpatch/shared';
import type { Executor } from '../src/db/client.js';

export interface RoadJoinTile extends Hex {
  readonly id: string;
  readonly ownerUserId: string | null;
  readonly homeSlot: number | null;
  readonly terrain: string;
}

/**
 * Pure: a tile of `userId`'s path to free so their land no longer touches
 * `village` through their own land, and a tile of theirs where a Paved road
 * (level 3) joins the land by the village back up to home.
 */
export function cutAndRoad<T extends RoadJoinTile>(
  tiles: readonly T[],
  userId: string,
  village: readonly Hex[],
): { cut: T; road: T } {
  for (const cut of tiles.filter((t) => t.ownerUserId === userId && t.homeSlot === null)) {
    const after = tiles.map((t) => (t.id === cut.id ? { ...t, ownerUserId: null } : t));
    if (communityReach(village, after, userId).reach === 'touching') continue;
    for (const road of after.filter((t) => t.ownerUserId === userId)) {
      const roads = [{ q: road.q, r: road.r, ownerUserId: userId, level: 3 }];
      const { supplied } = supplyMap(after, roads, [], userId, TRAVEL_RULES);
      if (communityReach(village, after, userId, supplied).reach === 'touching') {
        return { cut, road };
      }
    }
  }
  throw new Error('no tile to cut and road round');
}

/**
 * Makes the map a Wild Isle and frees the cut tile; the road (`found.road`)
 * is the test's to lay, so it can check the cut-off case first.
 */
export async function cutOffFromVillage<T extends RoadJoinTile>(
  db: Executor,
  mapId: string,
  tiles: readonly T[],
  userId: string,
  village: readonly Hex[],
): Promise<{ cut: T; road: T }> {
  await db.execute(`update maps set patch_type = 'wild-isle' where id = '${mapId}'`);
  const found = cutAndRoad(tiles, userId, village);
  await db.execute(`update tiles set owner_user_id = null where id = '${found.cut.id}'`);
  return found;
}
