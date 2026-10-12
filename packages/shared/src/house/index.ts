import type { HouseData, HouseLevel, HouseRoom, HouseRules } from '../schemas/data/house.js';
import type { ResidentAway } from '../schemas/house.js';
import type { SquishyJobId } from '../jobs/index.js';
import type { SquishyState } from '../schemas/squishies.js';

/*
 * Pure house rules (#381). No row in `keeper_houses` reads as level 1: the
 * Snug sprouts with the Heart Seed, free (owner decision 2026-10-11).
 */

/** The level a Keeper with no house row has. */
export const HOUSE_START_LEVEL = 1;

/** The top level in the data. */
export const maxHouseLevel = (data: HouseData): number => data.levels.length;

/**
 * A level's data, clamped into the table, so a level removed from the data
 * reads as the top one rather than failing (as `BUILDING_DATA` clamps).
 */
export function houseLevelData(data: HouseData, level: number): HouseLevel {
  const clamped = Math.min(Math.max(level, HOUSE_START_LEVEL), maxHouseLevel(data));
  const row = data.levels[clamped - 1];
  if (!row) throw new Error('houseLevelData: no house levels');
  return row;
}

/** The level after this one, or null at the top. */
export function nextHouseLevel(data: HouseData, level: number): HouseLevel | null {
  return level >= maxHouseLevel(data) ? null : houseLevelData(data, level + 1);
}

/** Every room a house at this level has, in the order they were added. */
export function roomsAt(data: HouseData, level: number): HouseRoom[] {
  const top = houseLevelData(data, level).level;
  return data.levels.filter((l) => l.level <= top).map((l) => l.room);
}

/** Beds across every room at this level. */
export function capacityAt(data: HouseData, level: number): number {
  return roomsAt(data, level).reduce((sum, room) => sum + room.beds, 0);
}

/*
 * Residents (#381 PR C, plan Q2 and Q5). A resident is an extra favourite:
 * it keeps its habitat and its job, and its happiness fades slower.
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * The percent of the normal happiness drain a squishy fades at (#376's
 * model: rate = base × fit × this). A resident resting in its bed gets the
 * perk; anyone else, and a resident away in the Hollow or at a trading post
 * (the perk pauses with everything else, plan Q5), fades at 100.
 */
export function residentDrainPercent(rules: HouseRules, resident: boolean): number {
  if (!resident) return 100;
  switch (rules.perk.kind) {
    case 'slower-drain':
      return rules.perk.drainPercent;
    case 'care-bonus':
      // TODO(#381): the fallback perk (an extra full-value care action a day,
      // plan Q2) isn't built: #376's checkpoint landed first, so the shipped
      // data names `slower-drain`. Until it is, a care-bonus resident fades
      // at the normal rate and care counts it like anyone.
      return 100;
  }
}

/** When a squishy that moved out at `movedOutAt` may move back in. */
export function moveBackInAt(movedOutAt: Date, rules: Pick<HouseRules, 'moveBackInHours'>): Date {
  return new Date(movedOutAt.getTime() + rules.moveBackInHours * HOUR_MS);
}

/** Why a resident isn't in its room right now: away in the Hollow, at a post, or at its job. */
export function residentAwayOf(state: SquishyState, job: SquishyJobId): ResidentAway | null {
  if (state === 'hollowed') return 'hollow';
  if (state === 'in-trade') return 'in-trade';
  switch (job) {
    case 'gatherer':
      return 'gathering';
    case 'guard':
      return 'guarding';
    case 'training':
      return 'training';
    case 'team':
    case 'resting':
      return null;
  }
}

/** Why a squishy can't move into a room (the server words each one). */
export type MoveInProblem = 'in-trade' | 'hollowed' | 'no-room' | 'cooldown' | 'full';

/** What `moveInProblem` looks at, read under the house and squishy locks. */
export interface MoveInFacts {
  state: SquishyState;
  /** The room it would move into, as built at this level; null when there's none. */
  room: Pick<HouseRoom, 'beds'> | null;
  /** Residents in that room now (its own Keeper's, away ones included). */
  inRoom: number;
  /** It lives in another room of this house now (a move between rooms). */
  movingRooms: boolean;
  /** When it last moved out of this Keeper's house, or null. */
  movedOutAt: Date | null;
  now: Date;
}

/**
 * Why this squishy can't move into the room, or null when it can. A room
 * tuned down below its residents evicts nobody: it just takes no one new
 * until it's under its beds again (plan §6). The cooldown counts only a
 * move back in from outside; moving between rooms is free.
 */
export function moveInProblem(facts: MoveInFacts, rules: HouseRules): MoveInProblem | null {
  if (facts.state === 'in-trade') return 'in-trade';
  if (facts.state === 'hollowed') return 'hollowed';
  if (facts.room === null) return 'no-room';
  if (
    !facts.movingRooms &&
    facts.movedOutAt !== null &&
    facts.now < moveBackInAt(facts.movedOutAt, rules)
  ) {
    return 'cooldown';
  }
  if (facts.inRoom >= facts.room.beds) return 'full';
  return null;
}
