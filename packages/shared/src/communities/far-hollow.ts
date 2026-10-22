import type { SeasonRun } from '../data/season-windows.js';
import { HEX_DIRECTIONS, hexDistance, hexKey, hexRing, type Hex } from '../hex/index.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { CommunityRules } from '../schemas/data/communities.js';

// The far Hollow (#306 PR 6, plan Q7, owner decision 7): a grey village of
// each kid's own, fresh every season. Pure: its layout is a function of the
// map's secret seed and the season, so nothing about it is stored but which
// spots a kid has searched (`far_hollow_explore`, keyed by the season's seed).

/** One of the far Hollow's tiles: where it sits in its own little layout and what it is. */
export interface FarHollowTile extends Hex {
  /** Its place in the layout, 0 first (the middle). */
  readonly index: number;
  readonly terrain: string;
}

/**
 * The seed of a season's far Hollow on a map: a new season is a new seed, so
 * last season's progress (keyed by its seed) simply stops matching. Server
 * only, like the map seed it comes from (rule 6).
 */
export function farHollowSeed(mapSeed: Seed, season: Pick<SeasonRun, 'id' | 'year'>): Seed {
  return deriveSeed(mapSeed, 'far-hollow', season.id, season.year);
}

/**
 * A season's far Hollow: its middle, the middle's 6 neighbours, then a few
 * tiles past them that each touch two of those, so the layout stays one
 * cosy blob. The same seed always gives the same tiles (tech spec §8).
 */
export function farHollowLayout(
  seed: Seed,
  rules: Pick<CommunityRules['farHollow'], 'tiles' | 'terrains'>,
): FarHollowTile[] {
  const rng = Rng.fromSeed(deriveSeed(seed, 'layout'));
  const count = rng.int(rules.tiles.min, rules.tiles.max);
  const places: Hex[] = [{ q: 0, r: 0 }, ...HEX_DIRECTIONS];
  // Ring 2's tiles between two neighbours (the six that aren't straight out).
  const taken = new Set(places.map(hexKey));
  const between = hexRing({ q: 0, r: 0 }, 2).filter(
    (h) => HEX_DIRECTIONS.filter((d) => hexDistance(h, d) === 1).length >= 2,
  );
  const free = between.filter((h) => !taken.has(hexKey(h)));
  while (places.length < count && free.length > 0) {
    const [picked] = free.splice(rng.int(0, free.length - 1), 1);
    if (picked) places.push(picked);
  }
  // Each tile's terrain from its own seed, so a tile count tuned mid-season
  // never re-rolls the terrains (and spots) of tiles kids have searched.
  return places.map((place, index) => ({
    index,
    q: place.q,
    r: place.r,
    terrain: Rng.fromSeed(deriveSeed(seed, 'terrain', index)).weighted(rules.terrains).terrain,
  }));
}
