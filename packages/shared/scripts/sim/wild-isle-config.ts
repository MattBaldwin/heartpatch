import { PATCH_ECONOMY_CONFIG } from './patch-economy-config.js';

/**
 * `pnpm sim:wild-isle` settings (#621 W1-8): the patch economy's kids on a
 * Wild Isle, building water works instead of resource buildings, under the
 * real weather plan and storm knocks. Like the other sims, the model only
 * reads game data and reports; the guards are what `wild-isle.test.ts`
 * asserts, so a data edit that breaks one fails CI.
 */

/** One kind of kid on a Wild Isle. Sessions, play and income are the patch economy kid's of the same id. */
export interface WildIsleKid {
  readonly id: string;
  /** The works they build, in order, each on the nearest homestead with its water. */
  readonly works: readonly string[];
  /** Highest level they upgrade them to, one level of each at a time. */
  readonly maxLevel: number;
  /** Never sold: kept for upgrades and fixes, or a Watermill's Greens. */
  readonly neverSell: readonly string[];
}

export interface WildIsleConfig {
  readonly days: number;
  /** The island's generator seed (its storms' and the weather's seeds derive from it). */
  readonly mapSeed: string;
  /** The first map-local day the run plays (an everyday weather table: no season running). */
  readonly firstDay: string;
  readonly kids: readonly WildIsleKid[];
  /** Days with no session at all (the away variant). */
  readonly awayDays: readonly number[];
  /** Owner decision 2026-10-22, as for resource buildings: upkeep is about a fifth of a day's output sold. */
  readonly upkeepShare: { readonly min: number; readonly max: number };
  /** A casual kid's first Fishing Pier by this day. */
  readonly firstPierByDay: number;
  /** An engaged kid's River Well by this day (revision 1 §3). */
  readonly riverWellByDay: number;
  /** Storm fixes and the output knocked buildings miss, as a whole percent of the output's worth at sell price. */
  readonly stormMaxPercent: number;
}

const kid = (id: string) => {
  const k = PATCH_ECONOMY_CONFIG.kids.find((x) => x.id === id);
  if (!k) throw new Error(`no patch economy kid "${id}"`);
  return k;
};

export const WILD_ISLE_CONFIG: WildIsleConfig = {
  days: 30,
  mapSeed: 'wild-isle-sim', // TUNE: any island will do; the fairness band keeps them alike
  firstDay: '2026-11-02',
  kids: [
    {
      id: kid('casual').id,
      works: ['fishing-pier', 'salt-pans'], // TUNE: guess, a coast kid
      maxLevel: 4,
      neverSell: ['glimmer'],
    },
    {
      id: kid('engaged').id,
      // TUNE: guess. Water first (revision 1: the River Well), then the coast and the mill.
      works: ['river-well', 'fishing-pier', 'irrigated-field', 'watermill', 'salt-pans'],
      maxLevel: 4,
      neverSell: ['glimmer', 'greens'],
    },
  ],
  awayDays: PATCH_ECONOMY_CONFIG.awayDays,
  upkeepShare: PATCH_ECONOMY_CONFIG.upkeepShare,
  firstPierByDay: 7, // TUNE: plan §6 W1-8
  riverWellByDay: 6, // TUNE: revision 1 §3
  stormMaxPercent: 10, // TUNE: plan §6 W1-8, of a week's output
};
