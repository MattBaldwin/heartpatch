import { TERRITORY_RULES } from '../../src/data/territory.js';
import type { TerritoryRules } from '../../src/schemas/data/territory.js';
import type { PvpMode } from '../../src/schemas/maps.js';

/**
 * Map-fill model settings (`pnpm sim:map-fill`): how fast kids colour in a
 * patch, and what land that misses you (owner decision 2026-10-06, design
 * review Q2) gives back when someone stops playing. Like the other sims, it
 * only reads game data and reports; it never changes a table.
 */

/** How one kind of kid looks after their land. */
export interface MapFillKid {
  readonly id: string;
  /**
   * Win chance (%) of a claim by guardian strength, 1 first (the last is
   * Juniper's Gap). `pnpm sim:progression` has both kids winning nearly every
   * try at 5 attempts a day, so these only shape the Gap and the order.
   */
  readonly winPercent: readonly number[];
  /** Days of the week (1–7) the kid plays. */
  readonly playDays: readonly number[];
  /** Whether the kid taps Visit (tends all their land) on a play day when some land misses them. */
  readonly visits: boolean;
  /**
   * Challenges (#203's model): the kid's win chance (%) against a rival
   * tile's guard, and how many squishies they bring. With 2 or more, one
   * breaks a fence and another fights the guard in the same challenge.
   */
  readonly guardWinPercent: number;
  readonly team: number;
  /** Fence segments the kid can afford on a play day (Emberwood they don't burn as fuel). */
  readonly fencesPerDay: number;
}

/**
 * Fences in the model (#203): a fence fight is a seeded roll, not an engine
 * battle. `breakPercent` is the chance the breaker breaks a segment at full
 * energy (it rises as the segment loses energy); a segment that holds loses
 * `holdLossPercent` of its energy, until its owner repairs it on a play day.
 */
export interface MapFillFences {
  readonly breakPercent: number;
  readonly holdLossPercent: number;
}

export interface MapFillRules {
  readonly label: string;
  readonly attemptsPerDay: number;
  readonly pvpMode: PvpMode;
  /** Null: land never fades (the shipped game before this change). */
  readonly tending: TerritoryRules['tending'] | null;
  /** Kids challenge a rival's land once nothing neutral is left next to theirs (#203). */
  readonly challenges: boolean;
  /** Kids fence their borders facing rivals (#203); null: no fences. */
  readonly fences: MapFillFences | null;
}

/** One kid in a scenario: their kind, and the day they stop playing (null: never). */
export interface Seat {
  readonly kid: MapFillKid;
  readonly stopsAfterDay: number | null;
}

export interface MapFillScenario {
  readonly id: string;
  readonly title: string;
  /** Map seats (`MAP_GEN.layouts`); empty seats' home rings are never claimed. */
  readonly mapSeats: number;
  readonly seats: readonly Seat[];
}

export const ENGAGED: MapFillKid = {
  id: 'engaged',
  winPercent: [100, 100, 95, 85, 50], // TUNE: guess, see winPercent
  playDays: [1, 2, 3, 4, 5, 6, 7],
  visits: true,
  guardWinPercent: 60, // TUNE: guess; evenly matched kids, the defender's guard on watch
  team: 3,
  fencesPerDay: 2, // TUNE: guess; ~12 spare Emberwood a day after fuel
};

export const CASUAL: MapFillKid = {
  id: 'casual',
  winPercent: [100, 95, 85, 70, 40], // TUNE: guess, see winPercent
  playDays: [1, 2, 3, 4, 5, 6, 7], // the progression model's casual kid plays every day
  visits: true,
  guardWinPercent: 45, // TUNE: guess
  team: 2,
  fencesPerDay: 1, // TUNE: guess
};

/** A casual kid who only plays three days a week: the hardest case for keeping land. */
export const PART_TIME: MapFillKid = {
  ...CASUAL,
  id: 'part-time',
  playDays: [1, 3, 5], // TUNE: Mon, Wed, Fri
};

/** When the idle kid in the "stops playing" scenarios walks away. */
export const STOPS_AFTER_DAY = 30;

export const MAP_FILL_CONFIG = {
  rootSeed: 'heartpatch-map-fill-v1',
  mapSeed: 'heartpatch-progression-map-1', // the progression model's map
  days: 75,
  /** Days away the "stops playing" tables show. */
  awayDays: [3, 7, 14, 21, 30, 45],
} as const;

export const NO_FADING: MapFillRules = {
  label: 'never fades',
  attemptsPerDay: TERRITORY_RULES.attemptsPerDay,
  pvpMode: 'gentle',
  tending: null,
  challenges: false,
  fences: null,
};

/** The fence model's numbers (#203). */
export const FENCE_MODEL: MapFillFences = {
  breakPercent: 60, // TUNE: guess; a level-matched breaker with a neutral matchup, 6 turns
  holdLossPercent: 40, // TUNE: guess; what a failed fence fight knocks off
};

export const FADING_GENTLE: MapFillRules = {
  label: 'fades, Gentle',
  attemptsPerDay: TERRITORY_RULES.attemptsPerDay,
  pvpMode: 'gentle',
  tending: TERRITORY_RULES.tending,
  challenges: false,
  fences: null,
};

export const FADING_ON: MapFillRules = { ...FADING_GENTLE, label: 'fades, On', pvpMode: 'on' };

/** Gentle, fading, and kids challenge each other once the map is full (#203's baseline). */
export const CHALLENGES_GENTLE: MapFillRules = {
  ...FADING_GENTLE,
  label: 'challenges, Gentle',
  challenges: true,
};

/** The same, with fences on borders facing rivals (#203). */
export const FENCES_GENTLE: MapFillRules = {
  ...CHALLENGES_GENTLE,
  label: 'fences, Gentle',
  fences: FENCE_MODEL,
};

export const MAP_FILL_RULES: readonly MapFillRules[] = [
  NO_FADING,
  FADING_GENTLE,
  FADING_ON,
  CHALLENGES_GENTLE,
  FENCES_GENTLE,
];

const playing = (kid: MapFillKid): Seat => ({ kid, stopsAfterDay: null });
const stopping = (kid: MapFillKid): Seat => ({ kid, stopsAfterDay: STOPS_AFTER_DAY });

export const MAP_FILL_SCENARIOS: readonly MapFillScenario[] = [
  {
    id: 'engaged-2',
    title: '2 engaged kids, 2 seats',
    mapSeats: 2,
    seats: [playing(ENGAGED), playing(ENGAGED)],
  },
  {
    id: 'casual-2',
    title: '2 casual kids, 2 seats',
    mapSeats: 2,
    seats: [playing(CASUAL), playing(CASUAL)],
  },
  {
    id: 'part-time-2',
    title: '2 part-time kids (3 days a week), 2 seats',
    mapSeats: 2,
    seats: [playing(PART_TIME), playing(PART_TIME)],
  },
  {
    id: 'engaged-4',
    title: '2 engaged kids, 4 seats',
    mapSeats: 4,
    seats: [playing(ENGAGED), playing(ENGAGED)],
  },
  {
    id: 'casual-4',
    title: '2 casual kids, 4 seats',
    mapSeats: 4,
    seats: [playing(CASUAL), playing(CASUAL)],
  },
  {
    id: 'engaged-stops',
    title: `2 engaged kids, 2 seats; one stops after day ${String(STOPS_AFTER_DAY)}`,
    mapSeats: 2,
    seats: [playing(ENGAGED), stopping(ENGAGED)],
  },
  {
    id: 'casual-stops',
    title: `2 casual kids, 2 seats; one stops after day ${String(STOPS_AFTER_DAY)}`,
    mapSeats: 2,
    seats: [playing(CASUAL), stopping(CASUAL)],
  },
  {
    id: 'four-one-stops',
    title: `4 kids (engaged, casual, part-time, casual), 4 seats; the last stops after day ${String(STOPS_AFTER_DAY)}`,
    mapSeats: 4,
    seats: [playing(ENGAGED), playing(CASUAL), playing(PART_TIME), stopping(CASUAL)],
  },
];
