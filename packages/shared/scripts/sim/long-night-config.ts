/**
 * Long Night model settings (`pnpm sim:long-night`, #727). Like the other
 * sims, the model only reads game data and reports; it never changes a
 * table. The kids are the design review's casual and engaged ones.
 */

/** How one kind of kid gets ready for a Long Night. Ids match the progression kids. */
export interface LongNightKid {
  readonly id: string;
  /**
   * Long Nights they go into with their fires fuelled through the night and
   * their squishies home, a whole percent. The rest they go in unstocked.
   */
  readonly stocksPercent: number;
  /**
   * Stocked Long Nights they still leave something in the dark (a gatherer
   * out past the light, a tile beyond any fire), a whole percent.
   */
  readonly strayPercent: number;
}

export interface LongNightConfig {
  readonly seed: string;
  /** Patches per weekday the patch starts on (every weekday is run). */
  readonly runs: number;
  /** Days from the patch's start that count as "month one". */
  readonly monthDays: number;
  /** The first day of the model's calendar (any date; every weekday start is run from it). */
  readonly startDate: string;
  /** The patch's Hollow Man strength, the admin percent (100 by default). */
  readonly strengthPercent: number;
  /** Days after the patch starts that each seat's Keeper joins, by seat count. */
  readonly joinDays: Readonly<Record<string, readonly number[]>>;
  readonly kids: readonly LongNightKid[];
  readonly gates: {
    /** A fuel-stocked casual kid holds at least this share of their counted Long Nights. */
    readonly stockedHoldsAtLeast: number;
    /** An unstocked casual kid holds at most this share. */
    readonly unstockedHoldsAtMost: number;
    /** A 4-seat casual patch, playing as casual kids do, holds about half its month-one Long Nights. */
    readonly patchHolds: readonly [number, number];
  };
}

export const LONG_NIGHT_CONFIG: LongNightConfig = {
  seed: 'sim-long-night',
  runs: 500,
  monthDays: 28,
  startDate: '2026-11-01',
  strengthPercent: 100,
  // TUNE: a patch fills over its first few days.
  joinDays: { '1': [0], '4': [0, 0, 1, 3] },
  kids: [
    // TUNE: a casual kid can light all their land (#277 guardrail c, `pnpm
    // sim:fuel`) and sees "Long Night in 3 days"; most weeks they top up.
    { id: 'casual', stocksPercent: 90, strayPercent: 8 },
    { id: 'engaged', stocksPercent: 97, strayPercent: 3 }, // TUNE:
  ],
  gates: {
    stockedHoldsAtLeast: 0.9, // plan 727b
    unstockedHoldsAtMost: 0.4, // plan 727b
    patchHolds: [0.4, 0.6], // plan 727b: "about half the time in month one"
  },
};
