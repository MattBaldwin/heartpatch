import { hexKey, type HexKey } from '../hex/index.js';
import { safeTiles, type SafeFire } from '../home/safe-tiles.js';
import type { MapView, PublicTile } from '../schemas/maps.js';
import {
  PatchCrownSchema,
  type KeeperStats,
  type PatchCrown,
  type PatchStats,
} from '../schemas/patch-stats.js';
import { isTradingPost } from '../territory/reach.js';

// Patch stats (#573): pure, so the server's numbers and crowns can be pinned
// by tests. The server passes the view it would send and each member's
// befriend counts; nothing here is a secret (a species count, never which).

/** A member's befriend counts, from the server's own tables. */
export interface MemberCounts {
  readonly befriended: number;
  readonly species: number;
}

/** Tiles lit by these tiles' lit Hearthfires, on the map only. */
function litBy(tiles: readonly PublicTile[], known: ReadonlySet<HexKey>): Set<HexKey> {
  const fires: SafeFire[] = [];
  for (const tile of tiles) {
    for (const b of tile.buildings) {
      if (b.lit === true && b.safeRadius !== null) fires.push({ at: tile, radius: b.safeRadius });
    }
  }
  return new Set([...safeTiles(fires)].filter((key) => known.has(key)));
}

/** Wild land still to claim: nobody's, and not a home base, trading post or village. */
function isWild(tile: PublicTile): boolean {
  return (
    tile.ownerUserId === null &&
    tile.homeSlot === null &&
    !isTradingPost(tile) &&
    (tile.communityId ?? null) === null
  );
}

/** Each crown's number for a Keeper. */
const CROWN_SCORE: Readonly<Record<PatchCrown, (k: KeeperStats) => number>> = {
  land: (k) => k.tiles,
  befriended: (k) => k.befriended,
  builder: (k) => k.buildings.reduce((sum, b) => sum + b.count, 0),
  brightest: (k) => k.lit,
  collector: (k) => k.species,
};

/**
 * Who wears each crown: everyone on the top number shares it (owner
 * decision 2026-10-19), and nobody wears one for a 0.
 */
export function crownHolders(keepers: readonly KeeperStats[]): Map<PatchCrown, Set<string>> {
  const holders = new Map<PatchCrown, Set<string>>();
  for (const crown of PatchCrownSchema.options) {
    const score = CROWN_SCORE[crown];
    const best = Math.max(0, ...keepers.map(score));
    holders.set(
      crown,
      new Set(best > 0 ? keepers.filter((k) => score(k) === best).map((k) => k.user.id) : []),
    );
  }
  return holders;
}

/** The patch's stats from the map view and each member's counts (by user id). */
export function patchStats(view: MapView, counts: ReadonlyMap<string, MemberCounts>): PatchStats {
  const known = new Set(view.tiles.map((t) => hexKey(t)));
  const keepers: KeeperStats[] = view.members.map((member) => {
    const id = member.user.id;
    const mine = view.tiles.filter((t) => t.ownerUserId === id);
    const built = new Map<string, number>();
    for (const tile of mine) {
      for (const b of tile.buildings) built.set(b.buildingId, (built.get(b.buildingId) ?? 0) + 1);
    }
    return {
      user: member.user,
      homeSlot: member.homeSlot,
      tiles: mine.length,
      homesteads: mine.filter((t) => (t.homestead ?? null) !== null).length,
      buildings: [...built]
        .map(([buildingId, count]) => ({ buildingId, count }))
        // Code points, not localeCompare: the same order on every engine.
        .sort(
          (a, b) =>
            b.count - a.count ||
            (a.buildingId < b.buildingId ? -1 : a.buildingId > b.buildingId ? 1 : 0),
        ),
      lit: litBy(mine, known).size,
      befriended: counts.get(id)?.befriended ?? 0,
      species: counts.get(id)?.species ?? 0,
      // TODO(#306 PR 3): villages restored, once restoring lands.
      villages: null,
      crowns: [],
    };
  });
  const holders = crownHolders(keepers);
  return {
    totals: {
      claimed: view.tiles.filter((t) => t.ownerUserId !== null).length,
      wild: view.tiles.filter(isWild).length,
      lit: litBy(view.tiles, known).size,
      villages: null,
    },
    keepers: keepers.map((k) => ({
      ...k,
      crowns: PatchCrownSchema.options.filter((c) => holders.get(c)?.has(k.user.id)),
    })),
  };
}
