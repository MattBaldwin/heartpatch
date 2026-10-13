import type { BattleAiPolicy } from '../../src/schemas/data/battle.js';

/**
 * Balance simulator settings (issue #12). The sim only reads game data and
 * reports what to tune; it never changes a table.
 */
export interface SimConfig {
  /** Every battle seed is `deriveSeed(rootSeed, ...)`, so a run is reproducible. */
  readonly rootSeed: string;
  /** Stances both sides cycle through (each battle is a mirror: same stance both sides). */
  readonly policies: readonly BattleAiPolicy[];
  /** Win rates above `high` or below `low` (0–1, draws count half) are flagged. */
  readonly thresholds: { readonly low: number; readonly high: number };
  readonly levels: {
    /** Base forms fight base forms at this level. */
    readonly base: number;
    /** Kids (#443, a middle stage) fight kids at this level. */
    readonly kid: number;
    /** Evolved forms (teens, stage 3) fight evolved forms at this level. */
    readonly evolved: number;
    /** Grown-ups (#495, stage 4) fight grown-ups at this level. */
    readonly grown: number;
    /** Element × feeling combos (equal stats) fight at this level. */
    readonly combo: number;
  };
  /** Battles per pairing per stance; half with each side starting as side `a`. */
  readonly games: {
    readonly species: number;
    readonly combo: number;
    /** Per species mirror match per ordered stance pair. */
    readonly stance: number;
  };
}

export const SIM_CONFIG: SimConfig = {
  rootSeed: 'heartpatch-balance-sim-v1',
  policies: ['balanced', 'aggressive', 'defensive'],
  thresholds: { low: 0.35, high: 0.65 }, // TUNE: issue #12 "e.g. >65% or <35%"
  levels: { base: 12, kid: 20, evolved: 25, grown: 40, combo: 15 }, // TUNE: wild 2–6, guardians 14–18, kids 16–30, teens 24–38, grown-ups 36–50
  games: { species: 100, combo: 20, stance: 100 }, // TUNE: more games, less noise, slower run
};
