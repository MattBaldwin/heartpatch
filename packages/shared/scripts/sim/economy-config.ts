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
  /** Homestead yield bonuses the report compares with the shipped one. */
  readonly candidates: readonly {
    readonly label: string;
    readonly homestead: { readonly yieldPercent: number; readonly yieldPlus: number };
  }[];
}

export const ECONOMY_CONFIG: EconomyConfig = {
  days: [7, 14, 30],
  seats: [4, 2],
  // TUNE: guesses. Casual: a short look twice a day, about one tile's spots
  // a day, and three of the squishies befriended by then (one a day) out
  // gathering. Engaged: five sessions, two or three tiles a day, six gatherers
  // (two befriended a day; the team of 3 stays home).
  profiles: [
    {
      id: 'casual',
      kid: 'casual',
      sessions: [8, 18],
      keeperNodes: 2,
      gatherers: 3,
      searchesPerDay: 10,
    },
    {
      id: 'engaged',
      kid: 'engaged',
      sessions: [7, 11, 15, 18, 20],
      keeperNodes: 4,
      gatherers: 6,
      searchesPerDay: 30,
    },
  ],
  // The owner's two starting points (2026-10-07), and a bigger one for scale.
  candidates: [
    { label: '+1 a cycle', homestead: { yieldPercent: 100, yieldPlus: 1 } },
    { label: '125 %, rounded up', homestead: { yieldPercent: 125, yieldPlus: 0 } },
    { label: '150 %, rounded up', homestead: { yieldPercent: 150, yieldPlus: 0 } },
  ],
};
