import { RAID_RULES } from '../../src/data/raids.js';
import { TERRITORY_RULES } from '../../src/data/territory.js';
import type { DefenseStance } from '../../src/schemas/data/raids.js';
import type { BattleAiPolicy } from '../../src/schemas/data/battle.js';

/**
 * `pnpm sim:tiles` (#529): how often a challenger takes a rival's tile, by
 * how well they prepared and how the tile is defended, with the guard level
 * floor (`watchFloor`) on or off. The plan's §3 table on issue #529 is this
 * config's report.
 */

/** How the challenger got ready. */
export interface TilePrep {
  readonly key: string;
  /**
   * How each fighter is picked against the guard it meets first: `full`, the
   * best element × feeling counter in the roster; `feeling`, the best feeling
   * counter (what a guardian hint reveals, #216); `none`, a random species.
   */
  readonly counter: 'full' | 'feeling' | 'none';
  /** Brave Brew on turn 1 and Hearty Soup under half energy, both free sips (#403). */
  readonly potions: boolean;
  /** Levels the team is below the challenger's Partner. */
  readonly levelsUnder: number;
  /**
   * The kid plays its counters: when a guard it hasn't met steps out, or its
   * fighter is tuckered out, it sends in the fighter it picked for that guard
   * (if that one can still fight). Otherwise the stand-in AI decides.
   */
  readonly swapsToCounter: boolean;
}

/** Who stands watch on the tile. */
export type TileGuards =
  /** The owner's own squishies, `below` levels under their Partner each (random species). */
  | { readonly kind: 'posted'; readonly below: readonly number[] }
  /** Nobody posted: the land's guardians stand in (`resolveGuardians`). */
  | { readonly kind: 'land'; readonly terrain: string; readonly strength: number };

export interface TileDefense {
  readonly key: string;
  readonly guards: TileGuards;
  /** A fence part came first, so the breaker sits out and one fewer fights (#203). */
  readonly fenced: boolean;
}

export interface TileSimConfig {
  readonly rootSeed: string;
  /** How the stand-in kid picks moves and who to send out. */
  readonly kidPolicy: BattleAiPolicy;
  /** The defender's stances for posted guards (land guardians always play `guardian`). */
  readonly stances: readonly DefenseStance[];
  /** The defender's Partner level; the challenger's team is at the same level. */
  readonly partnerLevels: readonly number[];
  /** `guardLevel.partnerBonus`, or null for no floor (`main` before #529). */
  readonly partnerBonus: number | null;
  /** The challenger's team size before a fence takes one. */
  readonly teamSize: number;
  readonly preps: readonly TilePrep[];
  readonly defenses: readonly TileDefense[];
  /** The map-local date the land's guardians are rolled for (picks the season). */
  readonly landDate: string;
  /** Battles per stance × prep × defense × Partner level. */
  readonly games: number;
}

const prepared = { counter: 'full', potions: true, levelsUnder: 0, swapsToCounter: true } as const;

export const TILE_SIM_CONFIG: TileSimConfig = {
  rootSeed: 'heartpatch-tiles-sim-v1',
  kidPolicy: 'balanced', // TUNE: a kid picks good moves most of the time
  stances: [RAID_RULES.defaultStance, 'aggressive', 'defensive'],
  partnerLevels: [10, 15, 20],
  partnerBonus: TERRITORY_RULES.guardLevel.partnerBonus,
  teamSize: 3,
  preps: [
    { key: 'prepared', ...prepared },
    { key: 'feeling-only', ...prepared, counter: 'feeling' },
    { key: 'potions-only', ...prepared, counter: 'none', swapsToCounter: false },
    { key: 'unprepared', counter: 'none', potions: false, levelsUnder: 0, swapsToCounter: false },
    { key: '3-under', ...prepared, levelsUnder: 3 },
  ],
  // TUNE: the plan's defenses: two or three spare squishies, or a strength-3
  // tile's guardians (two at 6–9) standing in.
  defenses: [
    { key: '2 posted, open', guards: { kind: 'posted', below: [4, 6] }, fenced: false },
    { key: '2 posted, fenced', guards: { kind: 'posted', below: [4, 6] }, fenced: true },
    { key: '3 posted, open', guards: { kind: 'posted', below: [3, 5, 7] }, fenced: false },
    { key: '3 posted, fenced', guards: { kind: 'posted', below: [3, 5, 7] }, fenced: true },
    {
      key: 'land guardians, open',
      guards: { kind: 'land', terrain: 'meadow', strength: 3 },
      fenced: false,
    },
    {
      key: 'land guardians, fenced',
      guards: { kind: 'land', terrain: 'meadow', strength: 3 },
      fenced: true,
    },
  ],
  // Out of season, so only the everyday tables guard: meadow has no seasonal
  // table, so Halloween would roll the same guardians anyway.
  landDate: '2026-06-15',
  games: 100, // TUNE: 300 per cell over three Partner levels, like the plan
};
