import { FUEL_CONFIG } from './fuel-config.js';

/**
 * `pnpm sim:patch-economy` settings (#601 PR 5). Like the other sims, the
 * model only reads game data and reports; it never changes a table. The
 * guards are what `patch-economy.test.ts` asserts, so a data edit that
 * breaks one fails CI.
 */

/** One kind of kid on a patch. Ids match the progression and fuel kids. */
export interface PatchEconomyKid {
  readonly id: string;
  /** Map-local hours the kid opens the patch (each opening settles: output lands, coins earn). */
  readonly sessions: readonly number[];
  /** Battles won a day, by kind (Heart Coins under the daily cap). */
  readonly wins: { readonly wild: number; readonly tile: number };
  /** Squishies befriended and tiles claimed a day. */
  readonly captures: { readonly wild: number; readonly tile: number };
  /** Care actions a day that count in full. */
  readonly fullCareActions: number;
  /** The resource buildings they build, in order (each on a homestead of its land). */
  readonly huts: readonly string[];
  /** Highest level they upgrade their huts to. */
  readonly maxLevel: number;
  /** Do they save for the Warehouse (after every hut reaches its level)? */
  readonly warehouse: boolean;
  /** Never sold, kept for upgrades. */
  readonly neverSell: readonly string[];
}

export interface PatchEconomyConfig {
  readonly days: number;
  /** Days the report shows balances and buildings on. */
  readonly reportDays: readonly number[];
  readonly seats: readonly number[];
  readonly kids: readonly PatchEconomyKid[];
  /** Days with no session at all (the away-3-days variant). */
  readonly awayDays: readonly number[];
  /**
   * Away days for the Warehouse's report: late enough that it stands, and
   * longer than a level-4 building's storage (96 h), or it adds nothing.
   */
  readonly warehouseAwayDays: readonly number[];
  /** Owner decision 2026-10-22: upkeep is about a fifth of a day's output sold. */
  readonly upkeepShare: { readonly min: number; readonly max: number };
  /** The casual kid pays at most this percent of their Heart Coins in upkeep, playing daily. */
  readonly casualUpkeepMaxPercent: number;
  /**
   * A first level-1 hut by this day. The model assumes a free homestead of
   * the right land, so this checks the build cost against early income only.
   */
  readonly firstHutByDay: Readonly<Record<string, number>>;
}

const fuel = (id: string) => {
  const profile = FUEL_CONFIG.profiles.find((p) => p.id === id);
  if (!profile) throw new Error(`no fuel kid "${id}"`);
  return profile;
};

export const PATCH_ECONOMY_CONFIG: PatchEconomyConfig = {
  days: 30,
  reportDays: [7, 14, 30],
  seats: [4, 2],
  kids: [
    {
      id: 'casual',
      sessions: fuel('casual').sessions,
      wins: { wild: 1, tile: 0 }, // TUNE: guess, the #601 plan's casual kid
      captures: { wild: 0, tile: 0 },
      fullCareActions: 3, // TUNE: one care session
      huts: ['woodcutters-hut', 'stone-quarry'],
      maxLevel: 4,
      warehouse: false,
      neverSell: ['glimmer'],
    },
    {
      id: 'engaged',
      sessions: fuel('engaged').sessions,
      wins: { wild: 2, tile: 1 }, // TUNE: guess, the plan's engaged kid
      captures: { wild: 0, tile: 1 },
      fullCareActions: 10, // TUNE: full care
      huts: ['woodcutters-hut', 'stone-quarry', 'greenhouse', 'water-well'],
      maxLevel: 4,
      warehouse: true,
      neverSell: ['glimmer'],
    },
  ],
  awayDays: [10, 11, 12],
  warehouseAwayDays: [24, 25, 26, 27, 28],
  upkeepShare: { min: 15, max: 25 },
  casualUpkeepMaxPercent: 60,
  firstHutByDay: { casual: 10, engaged: 5 },
};
