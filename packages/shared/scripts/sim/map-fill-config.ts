import { TERRITORY_RULES } from '../../src/data/territory.js';
import type { TerritoryRules } from '../../src/schemas/data/territory.js';
import type { PatchType } from '../../src/patch-types/index.js';
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
  /**
   * A computer patch-mate (#386c) with this persona id: it never plays like a
   * kid; on a day a kid plays (the patch is warm, rule C) it takes the
   * server's steps through the shared `nextIntent`.
   */
  readonly computer?: string;
}

export interface MapFillScenario {
  readonly id: string;
  readonly title: string;
  /** Map seats (`MAP_GEN.layouts`); empty seats' home rings are never claimed. */
  readonly mapSeats: number;
  readonly seats: readonly Seat[];
  /** Which generator (#621); absent: a Cozy Patch. */
  readonly patchType?: PatchType;
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

/**
 * Computer mates in the model (#386c): on a warm day (a kid played), each
 * mate takes `catchUpSteps` catch-up steps when the kid opens the patch,
 * then this many ordinary steps while it stays open (steps are 20–60 min
 * apart and the patch stays warm `warmMinutes` after a kid looks).
 */
export const MATE_STEPS_WHILE_OPEN = 3; // TUNE: guess, about one short session a day

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
/** A computer mate's seat: a kid who never plays, carrying the persona. */
const computer = (persona: string): Seat => ({
  kid: { ...CASUAL, id: `computer-${persona}`, playDays: [], visits: false },
  stopsAfterDay: null,
  computer: persona,
});
/** The three mates `fillTo: 4` gives a solo kid (the first three personas). */
const MATES = ['bramble', 'marigold', 'pocket'].map(computer);

/** Days a solo kid with computer mates plays before walking away (gate d). */
export const SOLO_AWAY_AFTER_DAY = 14;

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
  // Computer mates (#386c, plan §9): a solo kid with the 3 mates
  // `fillTo: 4` gives, against the matching 4-kid patch.
  {
    id: 'engaged-4-full',
    title: '4 engaged kids, 4 seats',
    mapSeats: 4,
    seats: Array.from({ length: 4 }, () => playing(ENGAGED)),
  },
  {
    id: 'casual-4-full',
    title: '4 casual kids, 4 seats',
    mapSeats: 4,
    seats: Array.from({ length: 4 }, () => playing(CASUAL)),
  },
  {
    id: 'solo-engaged-3-computers',
    title: '1 engaged kid and 3 computer mates, 4 seats',
    mapSeats: 4,
    seats: [playing(ENGAGED), ...MATES],
  },
  {
    id: 'solo-casual-3-computers',
    title: '1 casual kid and 3 computer mates, 4 seats',
    mapSeats: 4,
    seats: [playing(CASUAL), ...MATES],
  },
  {
    id: 'solo-away-3-computers',
    title: `1 casual kid and 3 computer mates, 4 seats; the kid stops after day ${String(SOLO_AWAY_AFTER_DAY)}`,
    mapSeats: 4,
    seats: [{ kid: CASUAL, stopsAfterDay: SOLO_AWAY_AFTER_DAY }, ...MATES],
  },
  // Wild Isle (#621, plan §2): water is a wall until roads, bridges and
  // ferries (W1-5a/5b), so this is the slowest a kid fills a Wild Isle.
  {
    id: 'wild-casual-6',
    title: '6 casual kids, a 6-seat Wild Isle',
    mapSeats: 6,
    seats: Array.from({ length: 6 }, () => playing(CASUAL)),
    patchType: 'wild-isle',
  },
  {
    id: 'wild-mixed-6',
    title: '6 kids (2 engaged, 2 casual, 2 part-time), a 6-seat Wild Isle',
    mapSeats: 6,
    seats: [ENGAGED, ENGAGED, CASUAL, CASUAL, PART_TIME, PART_TIME].map(playing),
    patchType: 'wild-isle',
  },
];

/**
 * The Wild Isle gate (#621, plan §2): every casual kid on a full Wild Isle
 * holds at least this many tiles by `byDay`.
 */
export const WILD_ISLE_FILL_GATE = { tiles: 40, byDay: 14 } as const; // TUNE:

/**
 * The computer-mates gates (#386c, plan §9), soft: `pnpm sim:map-fill`
 * prints PASS/FAIL. Each solo scenario's kid against the same kind of kid
 * in the 4-kid patch, on `byDay`, within `withinPercent`.
 */
export const COMPUTER_MATES_GATES = [
  { solo: 'solo-engaged-3-computers', full: 'engaged-4-full' },
  { solo: 'solo-casual-3-computers', full: 'casual-4-full' },
] as const;
export const COMPUTER_MATES_GATE = {
  byDay: 30,
  withinPercent: 10,
  away: 'solo-away-3-computers',
} as const; // TUNE:
