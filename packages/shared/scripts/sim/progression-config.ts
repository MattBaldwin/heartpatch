import { GROWTH_RULES } from '../../src/data/care.js';
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
  seats: [4, 2], // 4 is what new maps use (MAP_MAX_PLAYERS); 2 is the review's layout
};

/** The shipped data. */
export const CURRENT_RULES: ProgressionRules = {
  label: 'now',
  growth: GROWTH_RULES,
  spawn: SPAWN_RULES,
  attemptsPerDay: TERRITORY_RULES.attemptsPerDay,
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
