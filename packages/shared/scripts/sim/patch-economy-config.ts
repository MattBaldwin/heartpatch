import { POST_SHOP } from '../../src/data/post-shop.js';
import type { PostShop } from '../../src/schemas/data/post-shop.js';
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
  /**
   * Battles won a day, by kind (Heart Coins under the daily `battle` cap).
   * `defence`: rival-tile holds that pay (#728: a guard of theirs on watch or
   * a live defence; guardian-only holds and scooted challengers pay none).
   * `friendly`: friendly wins over one patch-mate, not counting scoots.
   * Rival-tile attack wins have no field of their own; fold them into `tile`.
   */
  readonly wins: {
    readonly wild: number;
    readonly tile: number;
    readonly defence: number;
    readonly friendly: number;
  };
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
  /** The engaged kid, once the Warehouse stands: upkeep is at most this percent of what they earn, leaving room to skip a sale. */
  readonly engagedUpkeepMaxPercent: number;
  /** #386d plan §9: a solo kid with computer mates ends within ± this percent of their 4-seat Heart Coins. */
  readonly soloGatePercent: number;
  /**
   * A first level-1 hut by this day. The model assumes a free homestead of
   * the right land, so this checks the build cost against early income only.
   */
  readonly firstHutByDay: Readonly<Record<string, number>>;
  /**
   * "What pays today" (#736): the `kid`'s balance on the last day against
   * everything 💛 buys in the last `weekDays` days other than upkeep (`shop`:
   * a price and how many a week, the Post shop's items at their caps).
   * Hard gate (#729): they can spend at least `minSpendPercent` of that
   * week's earnings on it.
   */
  readonly whatPays: {
    readonly kid: string;
    readonly weekDays: number;
    readonly minSpendPercent: number;
    readonly shop: readonly {
      readonly id: string;
      readonly price: number;
      readonly perWeek: number;
    }[];
  };
  /**
   * #729 plan §8: from `fromDay`, each kid (4 seats, playing daily, every
   * hut and the Warehouse) buys `perWeek` of the shop's `item` in any
   * `weekDays` days, after selling, when the balance covers it. Gate: every
   * one is bought and no building pauses a morning while they play.
   */
  readonly luresAffordable: {
    readonly item: string;
    readonly fromDay: number;
    readonly perWeek: Readonly<Record<string, number>>;
  };
}

/**
 * The Post shop as a week of buying (#729 plan §8): a day cap is `count`
 * a day for `weekDays` days, a week cap is `count` (rolling 7 patch days).
 * Night supplies (729b) are once per Long Night, not weekly: leave them out
 * when they ship.
 */
export function shopWeek(
  shop: PostShop,
  weekDays: number,
): { id: string; price: number; perWeek: number }[] {
  // Exhaustive on purpose: a new cap kind (729b's `long-night`) fails to
  // compile here until it is counted or left out.
  return shop.map((item) => {
    switch (item.cap.per) {
      case 'day':
        return { id: item.id, price: item.price, perWeek: item.cap.count * weekDays };
      case 'week':
        return { id: item.id, price: item.price, perWeek: item.cap.count };
    }
  });
}

const WHAT_PAYS_WEEK_DAYS = 7;
const RARE_LURE = POST_SHOP.find((item) => item.id === 'rare-lure');
if (!RARE_LURE) throw new Error('no rare-lure in POST_SHOP');

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
      // TUNE: guess, the #601 plan's casual kid; #728: one friendly a day
      // (sim:progression's casual kid), counted as won (an upper bound), no paid holds.
      wins: { wild: 1, tile: 0, defence: 0, friendly: 1 },
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
      // TUNE: guess, the plan's engaged kid; #728: three friendlies a day, two
      // won (rounded up), and one paid hold a day: an upper bound, since
      // sim:progression's kids rarely meet before neutral land runs out.
      wins: { wild: 2, tile: 1, defence: 1, friendly: 2 },
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
  soloGatePercent: 10, // #386 plan §9
  casualUpkeepMaxPercent: 60,
  engagedUpkeepMaxPercent: 70, // TUNE: a third of a full day's earning is slack
  firstHutByDay: { casual: 10, engaged: 5 },
  whatPays: {
    kid: 'casual',
    weekDays: WHAT_PAYS_WEEK_DAYS,
    minSpendPercent: 50, // TUNE: #736, half of what a casual kid earns
    shop: shopWeek(POST_SHOP, WHAT_PAYS_WEEK_DAYS),
  },
  luresAffordable: {
    item: RARE_LURE.id,
    fromDay: 10, // #729 plan §8
    // The casual kid at the Lure's weekly cap; the engaged kid, paying for
    // every hut and the Warehouse, one a week (TUNE: #729 plan §8).
    perWeek: { casual: RARE_LURE.cap.count, engaged: 1 },
  },
};
