import { hexKey, hexNeighbors, type Hex } from '../hex/index.js';
import { searchSpots, type SearchSpot } from '../explore/index.js';
import { deriveSeed, type Seed } from '../rng/index.js';
import type { CommunityRules } from '../schemas/data/communities.js';
import type { ExploreRules } from '../schemas/data/explore.js';
import type { ReachTile } from '../territory/reach.js';

// The key hunt and the hidden cellar (#306 PR 2c, owner decision 5): a won
// village's winner gets a map to the tile where the village squishies hid
// the cellar key, digs it up there, then opens the cellar under the square.
// Pure, so the server decides with it and the client explains with it.

/**
 * Can `userId` dig on the key's tile? It's theirs, or next to land they hold
 * (the reach claiming and wild squishies use). Whoever holds the key's tile,
 * and whatever stands on it, doesn't matter: digging the key up takes
 * nothing from that tile and changes nobody's land.
 */
export function keyInReach(keyTile: Hex, tiles: readonly ReachTile[], userId: string): boolean {
  const mine = new Set(tiles.filter((t) => t.ownerUserId === userId).map(hexKey));
  return mine.has(hexKey(keyTile)) || hexNeighbors(keyTile).some((n) => mine.has(hexKey(n)));
}

/**
 * A village's hidden cellar's search spots: the cellar kit
 * (`COMMUNITY_RULES.cellar`) laid out from the village's secret seed, the
 * same every time. The cellar is its own little room, so its spots are
 * placed as if on a tile at the origin, in the kit's borrowed look.
 */
export function cellarSpots(
  villageSeed: Seed,
  rules: Pick<CommunityRules, 'cellar'>,
  explore: ExploreRules,
): SearchSpot[] {
  const kit = rules.cellar;
  const spots = searchSpots(
    deriveSeed(villageSeed, 'cellar'),
    { q: 0, r: 0, terrain: kit.terrain },
    { ...explore, terrains: [kit] },
  );
  if (!spots || spots.length === 0) throw new Error('cellarSpots: the cellar kit placed no spots');
  return spots;
}
