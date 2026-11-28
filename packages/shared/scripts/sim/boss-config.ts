/**
 * Mini-boss team battle settings (`pnpm sim:boss`, #190). Like the other
 * sims, the model only reads game data and reports; it never changes a
 * table. The bosses are the visiting bag's boss forms (`BOSS_EVENTS.bag`,
 * #234). With an empty bag they fall back to stand-ins: existing grown-ups
 * flagged `boss`, so the gates test the team rules (`rules.team`,
 * `rules.boss`), not a boss's own moves.
 */
import { BOSS_EVENTS } from '../../src/data/server/boss-events.js';
export interface BossTeamShape {
  readonly key: string;
  /** Each member's level below the Partner's (0 is the Partner). */
  readonly levelsBelow: readonly number[];
  /**
   * How members are drawn: any element (`mixed`), elements the boss is weak
   * to (`good`), or elements it is strong against (`bad`).
   */
  readonly mix: 'mixed' | 'good' | 'bad';
}

/**
 * The Christmas Eve run (#37 X3): the Eve boss (`BOSS_EVENTS.christmasEve`)
 * fought with the same shapes and gates at `gatedLevel`, its spread read
 * against the bag bosses' balanced rates at `level`; `referenceLevels` are
 * reported without gates.
 */
export interface ChristmasSimConfig {
  /** Partner and boss level the Eve gates are read at (the Eve floor). */
  readonly gatedLevel: number;
  /** More levels to report, ungated. */
  readonly referenceLevels: readonly number[];
  /**
   * The `--patch` tally (addendum risks): `patches` patches of one Keeper
   * per entry in `partnerLevels`, each fighting `tries` times with the
   * first shape's team, the boss at the Eve gates (Partner + `levelBonus`,
   * at least `minLevel`). Points are the bar's (`chipPoints`).
   */
  readonly patch: {
    readonly patches: number;
    readonly tries: number;
    readonly partnerLevels: readonly number[];
  };
}

export interface BossSimConfig {
  /** Seeded battles per cell (team shape × boss × level bonus). */
  readonly games: number;
  readonly seed: string;
  /** The Partner's level, and the boss's. */
  readonly level: number;
  /** With an empty bag, stand-in bosses: this many grown-ups of different elements, by id order. */
  readonly bosses: number;
  /** The team's level over the boss's, per cell. */
  readonly levelBonuses: readonly number[];
  readonly shapes: readonly BossTeamShape[];
  readonly christmas: ChristmasSimConfig;
  /** The team's AI stance in the sim (a kid's picks, roughly). */
  readonly policy: 'balanced';
  readonly gates: {
    /** A balanced team of 3 at level wins this % of the time (inclusive). */
    readonly balanced: readonly [number, number];
    /** A team of 1 at level wins under this %. */
    readonly loneUnder: number;
    /** A team of 3 five levels over wins at least this %. */
    readonly overAtLeast: number;
    /** The balanced team's median fight, in rounds (inclusive). */
    readonly medianRounds: readonly [number, number];
    /** No boss's balanced win rate differs from another's by more than this many points. */
    readonly bossSpread: number;
  };
}

export const BOSS_SIM_CONFIG: BossSimConfig = {
  games: 2000,
  seed: 'sim-boss',
  level: 25,
  bosses: 3,
  levelBonuses: [0, 5],
  shapes: [
    { key: 'team of 3', levelsBelow: [0, 3, 6], mix: 'mixed' },
    { key: 'team of 3, good mix', levelsBelow: [0, 3, 6], mix: 'good' },
    { key: 'team of 3, bad mix', levelsBelow: [0, 3, 6], mix: 'bad' },
    { key: 'team of 2', levelsBelow: [0, 3], mix: 'mixed' },
    { key: 'team of 1', levelsBelow: [0], mix: 'mixed' },
  ],
  christmas: {
    // The Eve floor, where little Keepers fight (10 while the Eve has no rules: none to gate).
    gatedLevel: BOSS_EVENTS.christmasEve?.gates.minLevel ?? 10,
    referenceLevels: [25], // TUNE: the weekly sim level (`level` below)
    patch: {
      patches: 250, // TUNE:
      tries: BOSS_EVENTS.triesPerDay, // the addendum's "3 tries": one patch-local day's (Christmas morning gives 3 more)
      // TUNE: a mixed patch, little siblings to grown-ups (the Eve gate is player 5).
      partnerLevels: [5, 8, 12, 16, 20, 25, 30, 40],
    },
  },
  policy: 'balanced',
  // Plan §9 (owner-approved, #190).
  gates: {
    balanced: [55, 65],
    loneUnder: 15,
    overAtLeast: 85,
    medianRounds: [6, 10],
    bossSpread: 10,
  },
};
