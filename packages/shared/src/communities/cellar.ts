import { hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import { extraSpotAt, searchSpots, type SearchSpot } from '../explore/index.js';
import { deriveSeed, type Seed } from '../rng/index.js';
import type { CommunityRules } from '../schemas/data/communities.js';
import { MAX_SEARCH_SPOTS, type ExploreRules } from '../schemas/data/explore.js';
import type { PvpMode } from '../schemas/maps.js';
import { isTradingPost, type ReachTile } from '../territory/reach.js';

// The key hunt and the hidden cellar (#306 PR 2c, owner decision 5): a won
// village's winner gets a treasure map to the tile where the village
// squishies hid the cellar key, finds it there by exploring (a glinting spot,
// owner decision 2026-10-22), then opens the cellar under the square. Pure,
// so the server decides with it and the client explains with it.

/**
 * Can `userId` find the key on its tile? Once the tile is theirs (owner
 * decision 2026-10-22): on a patch with challenges, the key may lie on
 * another Keeper's land, won first in a battle. On a patch with no
 * challenges (`pvpMode` 'off') the key moves off claimed land (`keyMoveTo`);
 * only when no wild tile is near enough does it stay there, and then land of
 * theirs next to it is enough.
 */
export function keyInReach(
  keyTile: Hex,
  tiles: readonly ReachTile[],
  userId: string,
  pvpMode?: PvpMode,
): boolean {
  const at = hexKey(keyTile);
  const tile = tiles.find((t) => hexKey(t) === at);
  if (tile?.ownerUserId === userId) return true;
  if (pvpMode !== 'off' || !tile || tile.ownerUserId === null) return false;
  const mine = new Set(tiles.filter((t) => t.ownerUserId === userId).map(hexKey));
  return hexNeighbors(keyTile).some((n) => mine.has(hexKey(n)));
}

/** A tile as moving a key sees it. */
export interface KeyMoveTile extends ReachTile {
  readonly terrain: string;
  readonly communityId: string | null;
}

/**
 * Where a hunt's key moves to on a patch with no challenges (owner decision
 * 2026-10-22: keys hide only on wild land there), or null when it stays: on
 * a patch with challenges, on wild land, on the winner's own land, or when
 * no wild tile is within `range` steps (it then stays, `keyInReach`'s
 * next-door rule). The nearest wild tile wins, then (q, r) order, so the
 * same land always gives the same tile; it never lands where a key could
 * not be placed (`placeCommunities`) or on another village's key (`taken`).
 */
export function keyMoveTo(
  key: Hex,
  tiles: readonly KeyMoveTile[],
  winnerUserId: string,
  input: {
    readonly pvpMode: PvpMode;
    readonly range: number;
    readonly taken: ReadonlySet<HexKey>;
    readonly gapTerrain: string;
    readonly excludedTerrains: readonly string[];
  },
): Hex | null {
  if (input.pvpMode !== 'off') return null;
  const at = tiles.find((t) => hexKey(t) === hexKey(key));
  if (!at || at.ownerUserId === null || at.ownerUserId === winnerUserId) return null;
  let best: KeyMoveTile | null = null;
  let bestSteps = Infinity;
  for (const t of tiles) {
    if (
      t.ownerUserId !== null ||
      t.homeSlot !== null ||
      t.communityId !== null ||
      t.terrain === input.gapTerrain ||
      input.excludedTerrains.includes(t.terrain) ||
      isTradingPost(t) ||
      input.taken.has(hexKey(t))
    ) {
      continue;
    }
    const steps = hexDistance(key, t);
    if (steps > input.range) continue;
    if (
      steps < bestSteps ||
      (steps === bestSteps && best && (t.q < best.q || (t.q === best.q && t.r < best.r)))
    ) {
      best = t;
      bestSteps = steps;
    }
  }
  return best ? { q: best.q, r: best.r } : null;
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
  // Inside the margin, else anywhere on the tile; the middle only if no try
  // fits at all, which today's kits never come near (the tests lay out every terrain).
  const at = extraSpotAt(seed, spots, explore, KEY_SPOT_MARGIN) ??
    extraSpotAt(seed, spots, explore) ?? { x: 0, z: 0 };
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
