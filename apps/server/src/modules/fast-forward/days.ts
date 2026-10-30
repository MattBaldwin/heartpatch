/*
 * Where the casual kid stands at the end of day 3, 10 and 21 (#736 part B),
 * copied from `pnpm sim:progression` (shipped rules, 4-seat map, the casual
 * profile's `DayRecord`). The server can't import the sim (scripts aren't
 * built), so rerun it and update this table when the progression numbers move.
 */

export interface DayStanding {
  /** The Partner's level; its species follows its own line's evolutions. */
  readonly partnerLevel: number;
  /** The rest of the team, Partner left out. */
  readonly team: readonly { readonly speciesId: string; readonly level: number }[];
  /** Tiles owned, home ring included. */
  readonly tiles: number;
}

export const FAST_FORWARD_DAYS = {
  3: {
    partnerLevel: 15,
    team: [
      { speciesId: 'fuzzbolt', level: 10 },
      { speciesId: 'oinkle', level: 13 },
    ],
    tiles: 22,
  },
  10: {
    partnerLevel: 22,
    team: [
      { speciesId: 'glimmerock', level: 21 },
      { speciesId: 'fizzlepop', level: 17 },
    ],
    tiles: 57,
  },
  21: {
    partnerLevel: 27,
    team: [
      { speciesId: 'gemling', level: 23 },
      { speciesId: 'moonmoth', level: 21 },
    ],
    tiles: 112,
  },
} as const satisfies Record<number, DayStanding>;

export type FastForwardDay = keyof typeof FAST_FORWARD_DAYS;
