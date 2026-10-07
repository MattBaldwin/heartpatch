/**
 * Economy model settings (`pnpm sim:economy`, #199). Like the other sims,
 * the model only reads game data and reports; it never changes a table.
 */

/** How one kind of kid gathers and explores. */
export interface EconomyProfile {
  readonly id: string;
  /** The progression kid whose land this kid plays on. */
  readonly kid: string;
  /** Map-local hours the kid opens the game, in order (each opening settles the bag). */
  readonly sessions: readonly number[];
  /** Nodes the Keeper starts a gather on each session (best first). */
  readonly keeperNodes: number;
  /** Squishy gatherers, on the best spots the kid owns. */
  readonly gatherers: number;
  /** Search spots the kid explores a day (nearest land to home first). */
  readonly searchesPerDay: number;
}

export interface EconomyConfig {
  /** Days the report shows. */
  readonly days: readonly number[];
  /** Map seats to model, as `pnpm sim:progression` does. */
  readonly seats: readonly number[];
  readonly profiles: readonly EconomyProfile[];
}

export const ECONOMY_CONFIG: EconomyConfig = {
  days: [7, 14, 30],
  seats: [4, 2],
  // TUNE: the fuel report's two kids, plus exploring. Casual: a short look
  // twice a day, about one tile's spots a day. Engaged: five sessions and two
  // or three tiles a day. Hourly: the engaged kid's land, opened every hour
  // from 8:00 to 21:00, the most a speed bonus can be worth.
  profiles: [
    {
      id: 'casual',
      kid: 'casual',
      sessions: [8, 18],
      keeperNodes: 1,
      gatherers: 1,
      searchesPerDay: 10,
    },
    {
      id: 'engaged',
      kid: 'engaged',
      sessions: [7, 11, 15, 18, 20],
      keeperNodes: 3,
      gatherers: 3,
      searchesPerDay: 30,
    },
    {
      id: 'hourly',
      kid: 'engaged',
      sessions: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      keeperNodes: 3,
      gatherers: 3,
      searchesPerDay: 30,
    },
  ],
};
