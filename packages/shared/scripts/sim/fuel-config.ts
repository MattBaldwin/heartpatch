/**
 * Fuel model settings (`pnpm sim:fuel`, #202). Like the other sims, the model
 * only reads game data and reports; it never changes a table.
 */

/** How one kind of kid keeps their fires fed. Ids match the progression kids. */
export interface FuelProfile {
  readonly id: string;
  /** Map-local hours the kid opens the game, in order (each opening settles the bag). */
  readonly sessions: readonly number[];
  /** Emberwood nodes the Keeper starts a gather on each session (home's first). */
  readonly keeperNodes: number;
  /** Squishies the kid puts on Emberwood (best spots first: nodes, then old forest). */
  readonly gatherers: number;
  /** Their gathering speed, a whole percent (100: no match; 135 / 175: a match). */
  readonly gathererSpeedPercent: number;
}

export interface FuelConfig {
  /** Days the report shows. */
  readonly days: readonly number[];
  /** Map seats to model, as `pnpm sim:progression` does. */
  readonly seats: readonly number[];
  readonly profiles: readonly FuelProfile[];
  /** The issue's bar: fewer fires than this on day 14 asks for an Emberwood tune. */
  readonly enoughFiresByDay14: number;
}

export const FUEL_CONFIG: FuelConfig = {
  days: [7, 14, 30],
  seats: [4, 2],
  // TUNE: the design review's two kids. Casual: two short sessions, the Keeper
  // taps the home Emberwood node, one squishy (no match) works it. Engaged:
  // five sessions, the Keeper taps every Emberwood node they own, two gatherers.
  profiles: [
    { id: 'casual', sessions: [8, 18], keeperNodes: 1, gatherers: 1, gathererSpeedPercent: 100 },
    {
      id: 'engaged',
      sessions: [7, 11, 15, 18, 20],
      keeperNodes: 99,
      gatherers: 2,
      gathererSpeedPercent: 100,
    },
  ],
  enoughFiresByDay14: 3, // the issue's "fewer than 3 or 4 lit by day 14"
};
