import { hexKey, hexNeighbors, type Hex } from '../hex/index.js';
import { searchSpots, type SearchSpot } from '../explore/index.js';
import { deriveSeed, type Seed } from '../rng/index.js';
import type { CommunityRules } from '../schemas/data/communities.js';
import type { ExploreRules } from '../schemas/data/explore.js';
import type { ReachTile } from '../territory/reach.js';

// The key hunt and the hidden cellar (#306 PR 2c, owner decision 5): a won
// village's winner gets a map to the tile where the village squishies hid
// the cellar key, digs it up there, then opens the cellar under the square,
// a stone vault with a row of treasure chests (owner, 2026-10-22).
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

/** The big chest's spot kind: the cellar's best loot (#306, owner decision of 2026-10-22). */
export const BIG_CHEST_KIND = 'big-chest';

/** Is this cellar spot the big chest? */
export const isBigChest = (spot: { readonly kind: string }): boolean =>
  spot.kind === BIG_CHEST_KIND;

/**
 * A village's hidden cellar's chests (#306, owner decision of 2026-10-22):
 * the cellar kit (`COMMUNITY_RULES.cellar`) picks how many small chests and
 * their kinds from the village's secret seed, the same every time (a kind
 * picks its row of the find table; every kind is drawn as a chest). They
 * stand in a row along the back wall (`cellarChests`), alternating right and
 * left of the big chest, which is last: its index is the small chests' count.
 * So a small chest keeps the index its spot had before the chests, and the
 * cellar's saved progress (`cellar_searched`) still reads the same.
 */
export function cellarSpots(
  villageSeed: Seed,
  rules: Pick<CommunityRules, 'cellar' | 'cellarChests'>,
  explore: ExploreRules,
): SearchSpot[] {
  const kit = rules.cellar;
  const spots = searchSpots(
    deriveSeed(villageSeed, 'cellar'),
    { q: 0, r: 0, terrain: kit.terrain },
    { ...explore, terrains: [kit] },
  );
  if (!spots || spots.length === 0) throw new Error('cellarSpots: the cellar kit placed no spots');
  const { row, first, gap, curve, big } = rules.cellarChests;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const chests = spots.map((s, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const out = Math.floor(i / 2);
    return {
      ...s,
      tool: null,
      x: round(side * (first + out * gap)),
      z: round(row - out * curve),
    };
  });
  return [...chests, { index: spots.length, kind: BIG_CHEST_KIND, tool: null, x: 0, z: big }];
}
