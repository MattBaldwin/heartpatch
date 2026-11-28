import { FUEL_CONFIG } from './fuel-config.js';
import { PATCH_ECONOMY_CONFIG } from './patch-economy-config.js';

/**
 * `pnpm sim:clockwork` settings (#874 Wave 1, lane C6): the patch economy's
 * casual and engaged kids on a Clockwork Isle homestead for two weeks of
 * December, building from the real Clockwork rows (`BUILDINGS`,
 * `POWER_RULES`, `RAIL_RULES`, `RESEARCH_TREE`). Like the other sims, the
 * model only reads game data and reports; the guards are what
 * `clockwork.test.ts` asserts, so a data edit that breaks one fails CI.
 */

/** One thing a kid saves for: a building level, a research node, or rails to a Scrap Heap. */
export type ClockworkStep =
  | {
      readonly kind: 'build';
      readonly building: string;
      readonly level: number;
      /** Wire tiles laid to join it to a Windmill (a powered machine), `POWER_RULES.wire`. */
      readonly wires?: number;
      /** The tile's wind (1–3) for a Windmill. */
      readonly wind?: 1 | 2 | 3;
    }
  | { readonly kind: 'research'; readonly node: string }
  /** Rail tiles from the homestead to one Scrap Heap gatherer, `RAIL_RULES.levels[level - 1]`. */
  | { readonly kind: 'rail'; readonly gatherer: number; readonly tiles: number };

/** One kind of kid on a Clockwork Isle. Sessions and build income are the patch economy kid's of the same id. */
export interface ClockworkKid {
  readonly id: string;
  readonly sessions: readonly number[];
  /** Squishies on Scrap Heaps (one each), gathering Parts (`RESOURCES` parts `gather`). */
  readonly partsGatherers: number;
  /** Squishies on owned meadow, gathering Greens for the Sorter (`JOB_RULES.terrainYields`). */
  readonly greensGatherers: number;
  /** What they build and research, in order; each waits until the bag covers it. */
  readonly plan: readonly ClockworkStep[];
}

export interface ClockworkConfig {
  readonly days: number;
  /** The first map-local day (December 1: the Gift Wrapper is a Christmas build). */
  readonly firstDay: string;
  readonly kids: readonly ClockworkKid[];
  /**
   * Blueprints each tier-1 research node grants, where it differs from
   * `RESEARCH_TREE` (owner ruling 2026-11-28, supervisor 58: tier 1 grants
   * 8 in all, one time; lane C3 changes the data). Empty once the data says 8.
   */
  readonly grantsOverride: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The ruling's tier-1 Blueprint total. */
  readonly tier1Blueprints: number;
  /** Owner decision 2026-10-22, as for resource buildings: upkeep is about a fifth of a day's output sold. */
  readonly upkeepShare: { readonly min: number; readonly max: number };
  // Guards (plan §3 row C6, R1.3). TUNE: every one.
  readonly casualWindmillByDay: number;
  readonly casualSorterByDay: number;
  readonly engagedBeaconByDay: number;
  readonly maxPresentsPerDay: number;
}

const sessionsOf = (id: string) => {
  const profile = FUEL_CONFIG.profiles.find((p) => p.id === id);
  if (!profile || !PATCH_ECONOMY_CONFIG.kids.some((k) => k.id === id)) {
    throw new Error(`no fuel or patch economy kid "${id}"`);
  }
  return profile.sessions;
};

export const CLOCKWORK_CONFIG: ClockworkConfig = {
  days: 14,
  firstDay: '2026-12-01',
  kids: [
    {
      id: 'casual',
      sessions: sessionsOf('casual'),
      partsGatherers: 1, // TUNE: guess, one squishy on the nearest Scrap Heap
      greensGatherers: 1, // TUNE: guess, one on a meadow for the Sorter
      plan: [
        // TUNE: guess. Power first, then the bench, then the Sorter it unlocks.
        { kind: 'build', building: 'windmill', level: 1, wind: 2 },
        { kind: 'build', building: 'research-bench', level: 1 },
        { kind: 'research', node: 'sorting' },
        { kind: 'build', building: 'sorter', level: 1, wires: 2 },
        { kind: 'research', node: 'bright-bulbs' },
        { kind: 'build', building: 'clockwork-beacon', level: 1, wires: 3 },
      ],
    },
    {
      id: 'engaged',
      sessions: sessionsOf('engaged'),
      partsGatherers: 2, // TUNE: guess, a squishy on each of the home's two Scrap Heaps
      greensGatherers: 1, // TUNE: guess
      plan: [
        // TUNE: guess. Everything Wave 1 has, Beacon early (the Hollow Man), every Blueprint sink.
        { kind: 'build', building: 'windmill', level: 1, wind: 3 },
        { kind: 'build', building: 'research-bench', level: 1 },
        { kind: 'research', node: 'bright-bulbs' },
        { kind: 'build', building: 'rail-depot', level: 1 },
        { kind: 'rail', gatherer: 0, tiles: 2 },
        { kind: 'research', node: 'sorting' },
        { kind: 'build', building: 'clockwork-beacon', level: 1, wires: 3 },
        { kind: 'build', building: 'sorter', level: 1, wires: 2 },
        { kind: 'research', node: 'wrapping' },
        { kind: 'build', building: 'gift-wrapper', level: 1, wires: 1 },
        { kind: 'rail', gatherer: 1, tiles: 3 },
        { kind: 'research', node: 'tidy-rails' },
        { kind: 'build', building: 'windmill', level: 2 },
        { kind: 'build', building: 'research-bench', level: 2 },
        { kind: 'build', building: 'rail-depot', level: 2 },
        { kind: 'build', building: 'sorter', level: 2 },
      ],
    },
  ],
  // Owner ruling 2026-11-28 (supervisor 58): tier 1 grants 8, up from 6.
  // TUNE: how C3 splits the extra two is C3's call; one more each on the
  // two one-Blueprint nodes is the guess modelled here.
  grantsOverride: {
    'tidy-rails': { blueprints: 2 },
    wrapping: { blueprints: 2 },
  },
  tier1Blueprints: 8,
  upkeepShare: PATCH_ECONOMY_CONFIG.upkeepShare,
  casualWindmillByDay: 3, // TUNE: plan §3 row C6
  casualSorterByDay: 7, // TUNE: plan §3 row C6
  engagedBeaconByDay: 10, // TUNE: plan §3 row C6
  maxPresentsPerDay: 2, // TUNE: plan R1.3, so the Wrapper never swamps advent presents
};
