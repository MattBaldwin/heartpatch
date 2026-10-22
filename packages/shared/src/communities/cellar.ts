import { hexKey, type Hex } from '../hex/index.js';
import { extraSpotAt, searchSpots, type SearchSpot } from '../explore/index.js';
import { deriveSeed, type Seed } from '../rng/index.js';
import type { CommunityRules } from '../schemas/data/communities.js';
import { MAX_SEARCH_SPOTS, type ExploreRules } from '../schemas/data/explore.js';
import type { ReachTile } from '../territory/reach.js';

// The key hunt and the hidden cellar (#306 PR 2c, owner decision 5): a won
// village's winner gets a treasure map to the tile where the village
// squishies hid the cellar key, finds it there by exploring (a glinting spot,
// owner decision 2026-10-22), then opens the cellar under the square. Pure,
// so the server decides with it and the client explains with it.

/**
 * Can `userId` find the key on its tile? Only once the tile is theirs (owner
 * decision 2026-10-22): the key may lie on another Keeper's land, and the
 * Keeper wins that tile first.
 */
export function keyInReach(keyTile: Hex, tiles: readonly ReachTile[], userId: string): boolean {
  const at = hexKey(keyTile);
  return tiles.some((t) => t.ownerUserId === userId && hexKey(t) === at);
}

/**
 * The cellar key's glinting spot in explore (owner decision 2026-10-22): its
 * index sits past every progress bit (`MAX_SEARCH_SPOTS`), so it never counts
 * toward a tile's spots or its "fully explored", and its kind is its own.
 */
export const KEY_SPOT = { index: MAX_SEARCH_SPOTS, kind: 'cellar-key' } as const;

/** How far in from the tile's edge the key's glint stays, so the close-up shows it on the land, not against the sky. */
const KEY_SPOT_MARGIN = 0.3; // TUNE

/**
 * Where the key's glinting spot sits on its tile: clear of the tile's own
 * `spots` and building spots, the same every time for the same seed (the
 * server derives it from the secret map seed, so only the place is sent).
 */
export function keySpot(
  seed: Seed,
  spots: readonly SearchSpot[],
  explore: ExploreRules,
): SearchSpot {
  const at = extraSpotAt(seed, spots, explore, KEY_SPOT_MARGIN) ??
    extraSpotAt(seed, spots, explore) ?? {
      x: 0,
      z: 0,
    };
  return { index: KEY_SPOT.index, kind: KEY_SPOT.kind, tool: null, ...at };
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
