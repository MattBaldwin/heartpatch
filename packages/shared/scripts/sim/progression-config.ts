import { BUILDINGS } from '../../src/data/buildings.js';
import { BOSS_EVENTS } from '../../src/data/server/boss-events.js';
import { STARTERS } from '../../src/data/starters.js';
import { GROWTH_RULES } from '../../src/data/care.js';
import { EXPLORE_RULES } from '../../src/data/explore.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { SPAWN_RULES } from '../../src/data/server/spawn-rules.js';
import { TERRITORY_RULES } from '../../src/data/territory.js';
import type { BossEventRules } from '../../src/schemas/data/boss-events.js';
import type { GrowthRules } from '../../src/schemas/data/care.js';
import type { BattleAiPolicy } from '../../src/schemas/data/battle.js';
import type { SpawnRules } from '../../src/schemas/data/spawn-rules.js';
import { FACTORY_CONFIG } from './factory-config.js';
import type { Tier } from './progression-firsts.js';

/**
 * Progression model settings (`pnpm sim:progression`). Like the battle sim,
 * the model only reads game data and reports; it never changes a table.
 */

/** How one kind of kid plays. Both kinds play every day. */
export interface KidProfile {
  readonly id: string;
  /** Battles a day: tile tries first (up to the day's attempts), then wild ones. */
  readonly battlesPerDay: number;
  /** The care × habitat XP multiplier their squishies keep, as a percent (100–300). */
  readonly xpPercent: number;
  /** Wild squishies befriended a day at most (each replaces the weakest friend). */
  readonly befriendsPerDay: number;
}

/** The sim kid's befriend choice (`ProgressionRules.befriendPolicy`). */
export type BefriendPolicy = 'stronger' | 'collector';

/** The rules the model plays by: the shipped data, or a baseline to compare against. */
export interface ProgressionRules {
  readonly label: string;
  readonly growth: GrowthRules;
  readonly spawn: SpawnRules;
  readonly attemptsPerDay: number;
  /**
   * A benched teammate's share (%) of the best award on its side (#732):
   * `GROWTH_RULES.benchXpPercent` in the shipped data (`SHIPPED_BENCH_XP`).
   * None or 0: the bench earns nothing.
   */
  readonly benchXpPercent?: number;
  /**
   * How the sim kid picks a new friend after a won wild battle (#732 D3);
   * none means `'stronger'`. `'stronger'`: the friend replaces the weakest
   * team member when it's stronger. `'collector'`: it replaces the least-rare
   * team member when it's rarer, otherwise the weakest when it's stronger.
   * Never the Partner. A sim choice, not a game rule: the game lets a kid put
   * anyone on the team.
   */
  readonly befriendPolicy?: BefriendPolicy;
  /**
   * Training Grounds (owner decision 2026-10-06), or none: each night the
   * first `slots` team members (the Partner first) train and get `xpPerDay`
   * plain XP, no care multiplier and no battle falloff, before the day's
   * battles. An upper bound: a kid who moves their team to training every
   * night and back every morning.
   */
  readonly training?: { readonly slots: number; readonly xpPerDay: number };
  /**
   * Exploring your land (#199), or none: each day, before the day's battles,
   * the kid searches up to `searchesPerDay[kid]` spots on the land they own
   * (the real search-spot generator; each spot once, ever), and every team
   * member gets `xpPerSquishy` plain XP per search: no care multiplier and
   * no battle falloff, like the Training Grounds.
   */
  readonly explore?: {
    readonly xpPerSquishy: number;
    readonly searchesPerDay: Readonly<Record<string, number>>;
  };
  /**
   * Friendly battles (#728), or none: each day, after training and exploring
   * and before tile tries, the map's two kids play `perDay[kid]` friendlies,
   * team against team (both AI), on top of their `battlesPerDay`. Both sides
   * earn the engine's XP (the winner's 1.5×, the loser's 1×), one opponent's
   * worth with `oneOpponent`, then × `xpPercent` % (`friendlyBattleXp`, as
   * the battles service pays it), care × habitat, under the daily falloff,
   * and a friendly counts toward `fullWinsPerDay` only for the side that won
   * (#728, owner decision 2026-11-15). Played first, so their XP comes
   * before the falloff thins anything.
   */
  readonly friendlies?: {
    readonly perDay: Readonly<Record<string, number>>;
    /** `GROWTH_RULES.battleXpFalloff.friendlyPercent` in the shipped data. */
    readonly xpPercent: number;
    /**
     * Pay a friendly as one opponent's worth (the engine's XP ÷ opponents
     * tuckered out): `GROWTH_RULES.battleXpFalloff.friendlyOneOpponent`
     * in the shipped data (owner decision 2026-11-14, #728 option 1).
     */
    readonly oneOpponent?: boolean;
  };
  /**
   * Defences (#728, 728a's rules), or none: a kid's tile tries also weigh the
   * other kid's tiles next to their land (never a home ring, not before day
   * `shieldDays + 1`, at most `lossCapPerDay` taken from one kid a day), at
   * the odds against that kid's guards. The defender's first `maxDefenders`
   * team members stand guard on every tile at the watch floor (Partner level
   * + `partnerBonus`), playing the kid's policy; a hold pays them the engine's
   * side-b XP through the same growth rules and falloff, and counts as a win.
   */
  readonly defences?: {
    readonly shieldDays: number;
    readonly lossCapPerDay: number;
    readonly maxDefenders: number;
    readonly guardLevel: { readonly partnerBonus: number };
  };
  /**
   * Mini-boss visits (#190 plan §2, §3), or none (`BossModel`): a weekly
   * window in `play`, fought through the real team format, and the Heart
   * Charm asks after a win, paid from the kid's modelled charm supply.
   */
  readonly boss?: BossModel;
}

/**
 * The mini-boss model (#190 plan §9). `events` is the shipped
 * `BOSS_EVENTS` with a sim-only stand-in bag (the shipped bag is empty
 * until 234b), so the schedule, tries, levels and bundle are the server's.
 */
export interface BossModel {
  readonly events: BossEventRules;
  /** Stand-in bosses: this many grown-ups of different elements (`standInBosses`). */
  readonly standIns: number;
  /** Fights a kid starts on each patch-local day the boss is out (capped at `events.triesPerDay`). */
  readonly triesPerDay: Readonly<Record<string, number>>;
  /** The befriend ask after a win (plan §3, the numbers 190c ships). */
  readonly befriend: {
    readonly charmsPerAsk: number;
    readonly asksPerWin: number;
    readonly basePercent: number;
    /** Per squishy of the kid's still standing at the win. */
    readonly perStandingPercent: number;
    /** Per earlier "not yet" from this boss kind (warmth carries across visits). */
    readonly perMissPercent: number;
    /** The ask after this many misses always works. */
    readonly sureAfterMisses: number;
    /** A friend joins at this share (%) of the Partner's level, at least `minJoinLevel`, below its first evolution. */
    readonly joinLevelPercent: number;
    readonly minJoinLevel: number;
  };
  /** The kid's Heart Charm supply (none of it is in the base model). */
  readonly charms: {
    /** Charms in the bag on day 1 (the starter gift). */
    readonly start: number;
    /** Charms a kid makes a day (crafting). */
    readonly perDay: Readonly<Record<string, number>>;
    /** Charms a wild befriend costs, on average (the capture rolls). */
    readonly perWildFriend: number;
  };
}

/**
 * Friendly XP as the battles service pays it (#728b): the shipped
 * `GROWTH_RULES.battleXpFalloff` knobs, so the sim and production can't drift.
 */
export const SHIPPED_FRIENDLY_XP = {
  xpPercent: GROWTH_RULES.battleXpFalloff?.friendlyPercent ?? 100,
  oneOpponent: GROWTH_RULES.battleXpFalloff?.friendlyOneOpponent ?? false,
} as const;

/**
 * The bench's share as the battles service pays it (#732): the shipped
 * `GROWTH_RULES.benchXpPercent`, so the sim and production can't drift.
 */
export const SHIPPED_BENCH_XP = GROWTH_RULES.benchXpPercent ?? 0;

/**
 * The shipped Training Grounds at their top level, trained a whole capped
 * day (`JOB_RULES.training.maxHours`) every day: the most a kid can get.
 */
function topTraining(): { slots: number; xpPerDay: number } {
  const grounds = BUILDINGS.find((b) => b.kind === 'training-grounds');
  const top = grounds?.kind === 'training-grounds' ? grounds.levels.at(-1) : undefined;
  if (!top) throw new Error('no Training Grounds in the building data');
  return { slots: top.capacity, xpPerDay: top.xpPerHour * JOB_RULES.training.maxHours };
}

export interface ProgressionConfig {
  /** Every seed is `deriveSeed(rootSeed, ...)`, so a run is reproducible. */
  readonly rootSeed: string;
  /** The map's seed (`generateMap`). */
  readonly mapSeed: string;
  /** Map-local date of day 1 (seasons follow it). */
  readonly startDate: string;
  readonly days: number;
  readonly kids: readonly KidProfile[];
  /** The Partner both kids pick (a starter, level 1 on day 1). */
  readonly partner: string;
  /** Two friends befriended on day 1, behind the Partner on the team. */
  readonly teammates: readonly string[];
  readonly teammateLevel: number;
  /** A kid tries the best-odds tile next to their land while its odds are at least this (%). */
  readonly tryTileAt: number;
  /** A strength counts as "ready" once the team wins it at least this often (%). */
  readonly readyAt: number;
  /** Games per guardian strength for each day's odds estimate. */
  readonly estimateGames: number;
  /** The AI that stands in for the kid's choices. */
  readonly kidPolicy: BattleAiPolicy;
  /** Map seats to model (`MAP_GEN.layouts`); two kids of one kind share each map. */
  readonly seats: readonly number[];
  /**
   * The boredom gate (#736): for the `kid` profile, no more than `maxGapDays`
   * days between "firsts" (or from day 1 to the first, or from the last to
   * `windowDays`) within the first `windowDays` days.
   */
  readonly firstsGate: {
    readonly kid: string;
    readonly windowDays: number;
    readonly maxGapDays: number;
  };
}

export const PROGRESSION_CONFIG: ProgressionConfig = {
  rootSeed: 'heartpatch-progression-v1',
  mapSeed: 'heartpatch-progression-map-1',
  startDate: '2026-10-12',
  days: 60,
  // TUNE: the design review's two kids. Casual: two 10-minute sessions (about
  // 7 battles); engaged: five sessions (about 25). Casual keeps care up with
  // one matching habitat (≈1.5 × 1.35); engaged keeps everyone at the 3× cap.
  kids: [
    { id: 'casual', battlesPerDay: 7, xpPercent: 200, befriendsPerDay: 1 },
    { id: 'engaged', battlesPerDay: 25, xpPercent: 300, befriendsPerDay: 2 },
  ],
  partner: 'emberbun',
  teammates: ['pebblesnooze', 'fuzzbolt'],
  teammateLevel: 3,
  tryTileAt: 35, // TUNE: the design review's "tries a tile at 35 % or better"
  readyAt: 50,
  estimateGames: 16,
  kidPolicy: 'aggressive', // as in the design review's win-rate table
  // 4 was new maps' size when the journey gate was set (#318 made new maps 6;
  // older patches keep 4); 2 is the review's layout.
  seats: [4, 2],
  // TUNE: #736's default, something new for a casual kid at least every 5 days of the first month.
  firstsGate: { kid: 'casual', windowDays: 30, maxGapDays: 5 },
};

/** The shipped data. */
export const CURRENT_RULES: ProgressionRules = {
  label: 'now',
  growth: GROWTH_RULES,
  spawn: SPAWN_RULES,
  attemptsPerDay: TERRITORY_RULES.attemptsPerDay,
  training: topTraining(),
  benchXpPercent: SHIPPED_BENCH_XP,
};

/**
 * The shipped data plus exploring your land (#199) as designed. Not shipped
 * yet, so it isn't `CURRENT_RULES`; the gate test holds it to a day of the
 * shipped pace. Fold it into `CURRENT_RULES` when exploring ships.
 */
export const WITH_EXPLORE_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now + exploring',
  explore: {
    xpPerSquishy: EXPLORE_RULES.xpPerSquishy,
    // TUNE: the economy report's kids: about one tile a day, or two or three.
    searchesPerDay: { casual: 10, engaged: 30 },
  },
};

/**
 * The shipped data plus #728's friendlies and defences: both kids on the map
 * play friendlies against each other and try each other's land. A variant,
 * not `CURRENT_RULES`, because how often kids play each other is a guess;
 * the report holds the engaged kid's day-14 level to `FRIENDLY_GATE` of the
 * shipped pace.
 */
export const WITH_FRIENDLIES_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now + friendlies',
  friendlies: {
    perDay: { casual: 1, engaged: 3 }, // TUNE: #728 plan §9, the realistic volume
    ...SHIPPED_FRIENDLY_XP,
  },
  defences: {
    shieldDays: Math.ceil(TERRITORY_RULES.newPlayerShieldHours / 24),
    lossCapPerDay: TERRITORY_RULES.dailyLossCap.on,
    maxDefenders: TERRITORY_RULES.maxDefenders,
    guardLevel: TERRITORY_RULES.guardLevel,
  },
};

/**
 * #728's acceptance gate: friendlies and defences move the engaged kid's
 * Partner level on `day` by at most `maxLevels` (first map size).
 */
export const FRIENDLY_GATE: FriendlyGate = { kid: 'engaged', day: 14, maxLevels: 1 }; // the issue's criterion 2

/**
 * The shipped data with the bench at 25 % (#732: 25–50 is pre-approved as
 * data), beside the shipped 50 %, so the knob's lever shows in the report.
 */
export const BENCH_25_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now (bench 25 %)',
  benchXpPercent: 25,
};

/** `WITH_FRIENDLIES_RULES` with the bench at 25 % (#732). */
export const WITH_FRIENDLIES_BENCH_25_RULES: ProgressionRules = {
  ...WITH_FRIENDLIES_RULES,
  label: 'now + friendlies (bench 25 %)',
  benchXpPercent: 25,
};

/**
 * The shipped data with the collector befriend choice (#732 D3): a kid who
 * puts a rarer friend on the team even when it's weaker, so "the first day a
 * casual kid evolves a befriended rare" measures the game, not the sim kid's
 * taste (the #732 options page).
 */
export const COLLECTOR_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now (collector)',
  befriendPolicy: 'collector',
};

/** `WITH_FRIENDLIES_RULES` with the collector befriend choice (#732 D3). */
export const WITH_FRIENDLIES_COLLECTOR_RULES: ProgressionRules = {
  ...WITH_FRIENDLIES_RULES,
  label: 'now + friendlies (collector)',
  befriendPolicy: 'collector',
};

/**
 * The shipped data plus mini-boss visits (#190): a variant, not
 * `CURRENT_RULES`, because the shipped boss bag is empty until the boss
 * content lands (234b). The report holds it to `BOSS_GATE`.
 */
export const WITH_BOSS_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now + boss',
  boss: {
    events: BOSS_EVENTS,
    standIns: 3, // as `pnpm sim:boss`
    // TUNE: plan §9: a casual kid tries once a day while it's out; an engaged kid uses every try.
    triesPerDay: { casual: 1, engaged: BOSS_EVENTS.triesPerDay },
    // Plan §3 (owner-approved 2026-11-15); modelled from the plan, not 190c's code.
    befriend: {
      charmsPerAsk: 3,
      asksPerWin: 2,
      basePercent: 20,
      perStandingPercent: 5,
      perMissPercent: 15,
      sureAfterMisses: 4,
      joinLevelPercent: 50, // owner decision 4: half the Partner's level…
      minJoinLevel: 5, // …at least 5, below its first evolution
    },
    charms: {
      start: STARTERS.firstPickGift['heart-charm'] ?? 0,
      perDay: FACTORY_CONFIG.charmsPerDay, // the factory model's guess, so the sims agree
      perWildFriend: 2, // TUNE: guess; a near-out capture is 60–90 % for common to rare
    },
  },
};

/**
 * #190's gates (plan §9): the first boss beaten and the first boss friend
 * by these days (each kid kind, first map size, kid 0), and the boss's XP
 * moving day-14 and day-30 levels by at most `maxLevels` against the run
 * without bosses.
 */
export interface BossGate {
  readonly byDay: Readonly<Record<string, { readonly beaten: number; readonly friend: number }>>;
  readonly xpDays: readonly number[];
  readonly maxLevels: number;
}

// TUNE: plan §9's targets (owner-approved 2026-11-15).
export const BOSS_GATE: BossGate = {
  byDay: { casual: { beaten: 21, friend: 45 }, engaged: { beaten: 14, friend: 28 } },
  xpDays: [14, 30],
  maxLevels: 1,
};

/**
 * #732's per-tier gate: under `rules`, the `kid`'s first evolution of a
 * befriended squishy of each listed rarity line comes by that day (first
 * map size).
 */
export interface TierGate {
  readonly kid: string;
  readonly rules: ProgressionRules;
  readonly byDay: Readonly<Partial<Record<Tier, number>>>;
}

// TUNE: the issue's targets, rare ≤ day 10 and epic ≤ day 20, for a casual collector.
export const TIER_GATE: TierGate = {
  kid: 'casual',
  rules: COLLECTOR_RULES,
  byDay: { rare: 10, epic: 20 },
};

export interface FriendlyGate {
  readonly kid: string;
  readonly day: number;
  readonly maxLevels: number;
}

/**
 * The shipped data without Training Grounds: what `now` was before the
 * owner chose to build them (2026-10-06). Kept to show what training adds.
 */
export const NO_TRAINING_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now, no training',
  training: undefined,
};

/**
 * The shipped data without the befriend cap (`befriendBelowEvolution`): a
 * befriended squishy keeps its battle level. Kept to show what the cap does.
 */
export const UNCAPPED_BEFRIEND_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now, no befriend cap',
  growth: {
    ...GROWTH_RULES,
    befriendBelowEvolution: undefined,
    befriendNoEvolutionLevel: undefined,
  },
};

/**
 * The shipped data without the daily battle-XP falloff (`battleXpFalloff`).
 * Kept to show what the falloff does.
 */
export const NO_FALLOFF_RULES: ProgressionRules = {
  ...CURRENT_RULES,
  label: 'now, no XP falloff',
  growth: { ...GROWTH_RULES, battleXpFalloff: undefined },
};

/**
 * The rules before the 2026-10-06 balance pass (owner decisions on design
 * review Q1 and Q2): no knee on the XP curve, wild levels 2–6 for everyone and
 * 10 tile attempts a day. Kept so the report can show before and after.
 */
export const BASELINE_RULES: ProgressionRules = {
  label: 'before',
  growth: {
    ...GROWTH_RULES,
    xpCurve: { perLevel: 20, curve: 5 },
    befriendBelowEvolution: undefined,
    battleXpFalloff: undefined,
  },
  spawn: { ...SPAWN_RULES, levels: { min: 2, max: 6 }, partnerOffset: undefined },
  attemptsPerDay: 10,
};
