import type { SeasonRun } from '../data/season-windows.js';
import { deriveSeed, type Seed } from '../rng/index.js';

// The far Hollow (#306 PR 6, plan Q7, owner decision 7): a place of each
// kid's own, fresh every season (Halloween 2026: the Crooked House). Pure:
// what's in it is a function of the map's secret seed and the season, so
// only a kid's progress is stored, keyed by the season's seed.

/**
 * The seed of a season's far Hollow on a map: a new season is a new seed, so
 * last season's progress (keyed by its seed) simply stops matching. Server
 * only, like the map seed it comes from (rule 6).
 */
export function farHollowSeed(mapSeed: Seed, season: Pick<SeasonRun, 'id' | 'year'>): Seed {
  return deriveSeed(mapSeed, 'far-hollow', season.id, season.year);
}
