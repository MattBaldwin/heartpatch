import { deriveSeed, Rng } from '../rng/index.js';
import type { FeelingId } from '../schemas/data/elements.js';
import {
  HOUSE_NOTE_NAME,
  type HouseData,
  type HouseGiftRules,
  type HouseLevel,
  type HouseNote,
  type HouseRoom,
  type HouseRules,
} from '../schemas/data/house.js';
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
 * model: rate = base × fit × this). A resident gets the perk, out on a job
 * too (owner, 2026-10-12); anyone else, and a resident away in the Hollow or
 * at a trading post (the perk pauses with everything else, plan Q5), fades
 * at 100.
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

/*
 * The daily gift (#381 PR H, plan §1c "Daily return reasons"). Once a patch
 * day, a resident at home leaves its Keeper a small resource gift and a note.
 * The roll is seeded (tech spec §8), so the server can roll it lazily on the
 * first read of the day and any re-roll of the same inputs gives the same gift.
 */

/** A resident that can leave today's gift: at home (not away), with its feeling for the note. */
export interface HouseGiftGiver {
  squishyId: string;
  feeling: FeelingId;
}

/** What `rollHouseGift` rolls from. `day` is the patch's local day (`YYYY-MM-DD`). */
export interface HouseGiftInput {
  userId: string;
  mapId: string;
  day: string;
  level: number;
  /** Residents at home now; any order (they're sorted by id first). */
  givers: readonly HouseGiftGiver[];
}

/** Today's gift: who left it, what, how many, and which note. */
export interface HouseGiftRoll {
  giverSquishyId: string;
  itemId: string;
  count: number;
  noteId: string;
}

/** The seed for one Keeper's gift on one patch day. Never sent to the client. */
const giftSeed = (input: Pick<HouseGiftInput, 'userId' | 'mapId' | 'day'>, ...labels: string[]) =>
  deriveSeed('house-gift', input.mapId, input.userId, input.day, ...labels);

/** The gift-table row for a house at `level`: the highest `fromLevel` at or under it. */
export function houseGiftRow(
  rules: HouseGiftRules,
  level: number,
): HouseGiftRules['table'][number] {
  const row = rules.table.findLast((r) => r.fromLevel <= level) ?? rules.table[0];
  if (!row) throw new Error('houseGiftRow: no gift rows');
  return row;
}

/**
 * The note that goes with a gift from a giver of this feeling: one of the
 * notes for its feeling or for anyone, seeded by the Keeper's day and the
 * giver, so the same gift always shows the same note. A null feeling (the
 * giver is gone from the patch) picks from the notes for anyone.
 */
export function houseGiftNote(
  notes: readonly HouseNote[],
  input: Pick<HouseGiftInput, 'userId' | 'mapId' | 'day'> & {
    squishyId: string;
    feeling: FeelingId | null;
  },
): HouseNote {
  const fits = notes.filter((n) => n.feeling === undefined || n.feeling === input.feeling);
  const pool = fits.length > 0 ? fits : notes;
  return Rng.fromSeed(giftSeed(input, 'note', input.squishyId)).pick(pool);
}

/**
 * Today's gift for this Keeper, or null when no resident is home to leave
 * one. Pure and deterministic: the same Keeper, patch, day, level and givers
 * always roll the same gift, and another day rolls afresh.
 */
export function rollHouseGift(
  input: HouseGiftInput,
  rules: HouseGiftRules,
  notes: readonly HouseNote[],
): HouseGiftRoll | null {
  if (input.givers.length === 0) return null;
  const givers = [...input.givers].sort((a, b) => (a.squishyId < b.squishyId ? -1 : 1));
  const rng = Rng.fromSeed(giftSeed(input, 'gift'));
  const giver = rng.pick(givers);
  const gift = rng.weighted(houseGiftRow(rules, input.level).gifts);
  return {
    giverSquishyId: giver.squishyId,
    itemId: gift.itemId,
    count: rng.int(gift.min, gift.max),
    noteId: houseGiftNote(notes, { ...input, ...giver }).id,
  };
}

/** A note's line with the giver's name in it. */
export const renderHouseNote = (note: Pick<HouseNote, 'line'>, name: string): string =>
  note.line.replace(HOUSE_NOTE_NAME, () => name);
