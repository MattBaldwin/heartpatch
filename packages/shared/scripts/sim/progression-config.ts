import { BUILDINGS } from '../../src/data/buildings.js';
import { GROWTH_RULES } from '../../src/data/care.js';
import { EXPLORE_RULES } from '../../src/data/explore.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { SPAWN_RULES } from '../../src/data/server/spawn-rules.js';
import { TERRITORY_RULES } from '../../src/data/territory.js';
import type { GrowthRules } from '../../src/schemas/data/care.js';
import type { BattleAiPolicy } from '../../src/schemas/data/battle.js';
import type { SpawnRules } from '../../src/schemas/data/spawn-rules.js';

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

/** The rules the model plays by: the shipped data, or a baseline to compare against. */
export interface ProgressionRules {
  readonly label: string;
  readonly growth: GrowthRules;
  readonly spawn: SpawnRules;
  readonly attemptsPerDay: number;
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
}

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
};

/** The shipped data. */
export const CURRENT_RULES: ProgressionRules = {
  label: 'now',
  growth: GROWTH_RULES,
  spawn: SPAWN_RULES,
  attemptsPerDay: TERRITORY_RULES.attemptsPerDay,
  training: topTraining(),
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
  growth: { ...GROWTH_RULES, befriendBelowEvolution: undefined },
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
