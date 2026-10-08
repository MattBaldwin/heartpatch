import { hexDistance, hexKey, type Hex } from '../hex/index.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { TradingPostRules } from '../schemas/data/map-gen.js';
import { isTradingPost } from '../territory/reach.js';

// Trading posts (#30, #269; owner decision 4): 4 shared posts a map, spread
// fairly. The same rule places them on a new map (`generateMap`) and on an
// older map (the server's boot pass, over its stored tiles), so a map gets
// the same kind of layout either way. Pure and deterministic: integer maths,
// fixed iteration order, and ties broken by a seed.

/** What placement needs to know about a tile. */
export interface PostPlacementTile extends Hex {
  readonly terrain: string;
  readonly homeSlot: number | null;
  /** Null (or absent) on neutral land. Posts only go on neutral land. */
  readonly ownerUserId?: string | null;
}

export interface PostPlacementInput {
  /** Every tile on the map, in any order: they're sorted by (q, r) first, and the seed breaks ties. */
  readonly tiles: readonly PostPlacementTile[];
  /** Every home slot's Heart Seed, taken or not ("every possible home spot"). */
  readonly homes: readonly Hex[];
  /** Juniper's Gap's terrain: no post goes there. */
  readonly gapTerrain: string;
  readonly rules: TradingPostRules;
  /** The map's seed (secret, server-side). Only ties between equally fair layouts use it. */
  readonly seed: Seed;
}

/** Can a post stand here? Neutral, not home, not the Gap, not already a post. */
function isCandidate(tile: PostPlacementTile, gapTerrain: string): boolean {
  return (
    tile.homeSlot === null &&
    (tile.ownerUserId ?? null) === null &&
    tile.terrain !== gapTerrain &&
    !isTradingPost(tile)
  );
}

/**
 * Where a map's trading posts go, sorted by (q, r) (a post's index on the
 * map is its place in this order), or null when no fair layout fits.
 *
 * Hard rules: every post stands on neutral land at least `minFromSeed` and
 * at most `maxFromSeed` steps from some Heart Seed, and at least `minApart`
 * from the other posts; every home has a post within `maxFromSeed`, and the
 * homes' nearest posts are the same distance away, or at most one step
 * apart when that's all the free land allows.
 *
 * 1. **One post for each home**, all at the same distance `d`, the smallest
 *    that fits: every combination of one tile at `d` per home is tried, and
 *    the ones whose closest two posts are furthest apart win (the map seed
 *    picks between ties). Only when no tile set fits at exactly `d` for any
 *    `d` may a home's nearest be `d + 1`.
 * 2. **Any posts left over** (2- and 3-seat maps) go one at a time where
 *    they're furthest from the others without bringing any home a closer
 *    post than the others have, so neighbours end up sharing them.
 */
export function placeTradingPosts(input: PostPlacementInput): Hex[] | null {
  const { rules, homes } = input;
  // (q, r) order, so mapgen's spiral and the server's stored rows give the
  // same posts: the input order never decides anything.
  const candidates = input.tiles
    .filter((t) => {
      if (!isCandidate(t, input.gapTerrain)) return false;
      const nearest = Math.min(...homes.map((h) => hexDistance(h, t)));
      return nearest >= rules.minFromSeed && nearest <= rules.maxFromSeed;
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);
  if (homes.length === 0 || homes.length > rules.perMap || candidates.length < rules.perMap) {
    return null;
  }
  const rng = Rng.fromSeed(deriveSeed(input.seed, 'trading-posts'));
  const seats = firstPosts(candidates, homes, rules, rng);
  if (seats === null) return null;
  const chosen = [...seats.posts];
  const nearest = homes.map((h) => Math.min(...chosen.map((p) => hexDistance(h, p))));
  while (chosen.length < rules.perMap) {
    let pick: Hex | null = null;
    let pickApart = -1;
    for (const c of candidates) {
      if (chosen.some((p) => p.q === c.q && p.r === c.r)) continue;
      const gap = Math.min(...chosen.map((p) => hexDistance(c, p)));
      if (gap < rules.minApart || gap <= pickApart) continue;
      // Fair stays fair: no home gets a post nearer than its own one.
      if (homes.some((h, i) => hexDistance(h, c) < (nearest[i] as number))) continue;
      pick = c;
      pickApart = gap;
    }
    if (pick === null) return null;
    chosen.push(pick);
  }
  return chosen.map((h) => ({ q: h.q, r: h.r })).sort((a, b) => a.q - b.q || a.r - b.r);
}

/** Step 1 of `placeTradingPosts`: one post per home, all equally near. */
function firstPosts(
  candidates: readonly Hex[],
  homes: readonly Hex[],
  rules: TradingPostRules,
  rng: Rng,
): { posts: Hex[] } | null {
  for (const slack of [0, 1]) {
    for (let d = rules.minFromSeed; d + slack <= rules.maxFromSeed; d++) {
      // Each home's own options: tiles d to d + slack from it.
      const options = homes.map((h) =>
        candidates.filter((c) => {
          const steps = hexDistance(h, c);
          return steps >= d && steps <= d + slack;
        }),
      );
      if (options.some((o) => o.length === 0)) continue;
      let bestApart = -1;
      let best: Hex[][] = [];
      const picked: Hex[] = [];
      const visit = (slot: number, apart: number): void => {
        if (slot === homes.length) {
          // Every home's nearest post must land in the window too: another
          // home's post mustn't be nearer than d.
          const fair = homes.every((h) => {
            const near = Math.min(...picked.map((p) => hexDistance(h, p)));
            return near >= d && near <= d + slack;
          });
          if (!fair || apart < bestApart) return;
          if (apart > bestApart) {
            bestApart = apart;
            best = [];
          }
          best.push([...picked]);
          return;
        }
        for (const c of options[slot] as Hex[]) {
          let gap = apart;
          for (const p of picked) gap = Math.min(gap, hexDistance(c, p));
          if (gap < rules.minApart || gap < bestApart) continue;
          picked.push(c);
          visit(slot + 1, gap);
          picked.pop();
        }
      };
      visit(0, Infinity);
      if (best.length > 0) return { posts: rng.pick(best) };
    }
  }
  return null;
}

/** A post's index and name on its map: its place among the map's posts in (q, r) order. */
export interface TradingPostLabel {
  readonly index: number;
  readonly name: string;
}

/**
 * Names every trading post on the map by its index in (q, r) order (#269).
 * Keyed by `hexKey`. Nothing is stored: the order is the tiles'.
 */
export function tradingPostLabels(
  tiles: readonly (Hex & { readonly terrain: string })[],
  rules: Pick<TradingPostRules, 'names'>,
): Map<string, TradingPostLabel> {
  const posts = tiles.filter(isTradingPost).sort((a, b) => a.q - b.q || a.r - b.r);
  return new Map(
    posts.map((p, index) => [
      hexKey(p),
      { index, name: rules.names[index % rules.names.length] ?? 'Trading Post' },
    ]),
  );
}
