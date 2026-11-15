/**
 * Mini-boss team battle settings (`pnpm sim:boss`, #190). Like the other
 * sims, the model only reads game data and reports; it never changes a
 * table. Until the boss content lands (234b), the bosses are stand-ins:
 * existing grown-ups flagged `boss`, so the gates test the team rules
 * (`rules.team`, `rules.boss`), not a boss's own moves.
 */
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

export interface BossSimConfig {
  /** Seeded battles per cell (team shape × boss × level bonus). */
  readonly games: number;
  readonly seed: string;
  /** The Partner's level, and the boss's. */
  readonly level: number;
  /** Stand-in bosses: this many grown-ups of different elements, by id order. */
  readonly bosses: number;
  /** The team's level over the boss's, per cell. */
  readonly levelBonuses: readonly number[];
  readonly shapes: readonly BossTeamShape[];
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
