import {
  HOUSE_DATA,
  type HouseRoomView,
  type HouseView,
  type ResidentAway,
} from '@heartpatch/shared';
import { MOOD_WORDS } from '../care/mood-hearts.js';
import type { RosterRow } from '../squishies/roster/roster-view.js';
import { inSentence } from './house-grow-view.js';
import { RESIDENT_TEXT } from './house-view.js';

/*
 * Who lives where in the house (#381 plan §10.2–10.3, Q5), pure so every
 * case is unit-tested: the open sheet's bed chips, room by room, and the
 * move-in picker's rows with why a squishy can't come. The people are the
 * Squishies roster's rows (#375), so a squishy reads the same everywhere.
 * The client only shows these; the server decides every move (rule 1).
 */

/** A bed: someone home, someone away (and why), or empty. */
export type BedKind = 'home' | ResidentAway | 'empty';

export interface BedChip {
  readonly kind: BedKind;
  readonly roomId: string;
  /** The resident, or null on an empty bed. */
  readonly squishyId: string | null;
  /** The resident's roster row, or null (an empty bed, or a squishy not in the reads yet). */
  readonly person: RosterRow | null;
  /** The resident's name, or "+ Move in". */
  readonly name: string;
  /** Its mood ("😊 Happy"), where it is instead ("Gathering 🧺"), or "" on an empty bed. */
  readonly line: string;
  /** The longer words for its detail ("Out gathering 🧺", the mood's sentence), or "". */
  readonly about: string;
  /** What to do next, under the detail (style guide §3.5): how to rescue one in the Hollow. */
  readonly next: string | null;
}

export interface RoomBeds {
  readonly room: HouseRoomView;
  /** "The Snug · 1 of 2 beds". */
  readonly title: string;
  readonly chips: readonly BedChip[];
  /** Empty beds. */
  readonly free: number;
}

/** A resident that isn't in the reads yet still gets a name. */
const SOMEONE = 'Your squishy';

function residentChip(
  room: HouseRoomView,
  squishyId: string,
  away: ResidentAway | null,
  person: RosterRow | null,
): BedChip {
  const mood = person?.mood ?? null;
  return {
    kind: away ?? 'home',
    roomId: room.id,
    squishyId,
    person,
    name: person?.name ?? SOMEONE,
    line:
      away !== null
        ? RESIDENT_TEXT.awayShort[away]
        : mood
          ? `${MOOD_WORDS[mood.mood].icon} ${MOOD_WORDS[mood.mood].word}`
          : RESIDENT_TEXT.home,
    about: away !== null ? RESIDENT_TEXT.away[away] : (mood?.line ?? ''),
    next: away === 'hollow' ? RESIDENT_TEXT.hollowNext : null,
  };
}

/**
 * Every room in order with its beds: its residents first (as the server
 * lists them), then an empty chip per free bed. A room tuned below its
 * residents still shows them all (nobody is ever hidden).
 */
export function roomBeds(
  view: Pick<HouseView, 'rooms'>,
  people: ReadonlyMap<string, RosterRow>,
): RoomBeds[] {
  return view.rooms.map((room) => {
    const lived = room.residents.map((r) =>
      residentChip(room, r.squishyId, r.away, people.get(r.squishyId) ?? null),
    );
    const free = Math.max(0, room.beds - room.residents.length);
    const empty = Array.from({ length: free }, (): BedChip => ({
      kind: 'empty',
      roomId: room.id,
      squishyId: null,
      person: null,
      name: RESIDENT_TEXT.moveIn,
      line: '',
      about: '',
      next: null,
    }));
    return {
      room,
      title: RESIDENT_TEXT.beds(room.name, room.residents.length, room.beds),
      chips: [...lived, ...empty],
      free,
    };
  });
}

/** Where each resident lives, by squishy id. */
export function residentRooms(
  view: Pick<HouseView, 'rooms'>,
): Map<string, { roomId: string; away: ResidentAway | null }> {
  const out = new Map<string, { roomId: string; away: ResidentAway | null }>();
  for (const room of view.rooms) {
    for (const r of room.residents) out.set(r.squishyId, { roomId: room.id, away: r.away });
  }
  return out;
}

const HOUR_MS = 3_600_000;

/** Whole hours (rounded up, at least 1) until `at`, or null once it has passed. */
export function hoursUntil(at: string, nowMs: number): number | null {
  const left = Date.parse(at) - nowMs;
  if (!(left > 0)) return null;
  return Math.max(1, Math.ceil(left / HOUR_MS));
}

/** How long a squishy that moved out waits before it may move back in (data). */
export const MOVE_BACK_IN_HOURS = HOUSE_DATA.rules.moveBackInHours;

/**
 * What a picker row does: moves in, moves over from another room, or can't
 * come (it already lives here, waits at a post, is in the Hollow, or just
 * moved out).
 */
export type PickKind = 'in' | 'over' | 'here' | 'in-trade' | 'hollowed' | 'cooldown' | 'full';

export interface PickRow {
  readonly row: RosterRow;
  readonly kind: PickKind;
  /** A tap moves it (the server still checks). */
  readonly can: boolean;
  /** "Lives in the Playroom" for a resident of another room, else null. */
  readonly tag: string | null;
  /** Why it can't come ("Back in 5 h"), else null. */
  readonly reason: string | null;
}

export interface Picker {
  readonly room: HouseRoomView;
  /** "Who moves into the Snug?" */
  readonly title: string;
  /** "1 bed free", or the room-is-full line. */
  readonly line: string;
  readonly full: boolean;
  readonly rows: readonly PickRow[];
}

/** Rows that can come first (residents of other rooms first), then the dimmed ones. */
const RANK: Record<PickKind, number> = {
  over: 0,
  in: 1,
  here: 2,
  cooldown: 3,
  'in-trade': 4,
  hollowed: 5,
  full: 6,
};

/**
 * The move-in picker for `roomId`: every squishy of mine (the roster's
 * rows), each with what a tap does or why it can't come. Who lives where
 * comes from the house reply (the newest word), the cooldowns from
 * `HouseView.cooldowns` at `nowMs` (the server's clock). Null for a room
 * the house doesn't have.
 */
export function pickerFor(
  view: Pick<HouseView, 'rooms' | 'cooldowns'>,
  roomId: string,
  rows: readonly RosterRow[],
  nowMs: number,
): Picker | null {
  const room = view.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const lives = residentRooms(view);
  const rooms = new Map(view.rooms.map((r) => [r.id, r]));
  const cooldowns = new Map(view.cooldowns.map((c) => [c.squishyId, c.moveBackInAt]));
  const free = Math.max(0, room.beds - room.residents.length);
  const full = free === 0;
  const picked = rows.map((row): PickRow => {
    const home = lives.get(row.id) ?? null;
    const away = home?.away ?? null;
    // Where it lives, on every row that lives somewhere: "Lives here" or "Lives in the Snug".
    const homeRoom = home ? rooms.get(home.roomId) : undefined;
    const livesTag = homeRoom
      ? homeRoom.id === roomId
        ? RESIDENT_TEXT.livesHere
        : RESIDENT_TEXT.livesIn(inSentence(homeRoom.name))
      : null;
    if (away === 'in-trade' || row.status.kind === 'in-trade') {
      return {
        row,
        kind: 'in-trade',
        can: false,
        tag: livesTag,
        reason: RESIDENT_TEXT.away['in-trade'],
      };
    }
    if (away === 'hollow' || row.status.kind === 'hollowed') {
      return {
        row,
        kind: 'hollowed',
        can: false,
        tag: livesTag,
        reason: RESIDENT_TEXT.away.hollow,
      };
    }
    if (home?.roomId === roomId) {
      return { row, kind: 'here', can: false, tag: null, reason: RESIDENT_TEXT.livesHere };
    }
    const backIn = home ? null : cooldowns.get(row.id);
    const wait = backIn ? hoursUntil(backIn, nowMs) : null;
    if (wait !== null) {
      return {
        row,
        kind: 'cooldown',
        can: false,
        tag: null,
        reason: RESIDENT_TEXT.cantCooldown(wait),
      };
    }
    if (full) {
      return { row, kind: 'full', can: false, tag: livesTag, reason: RESIDENT_TEXT.cantFull };
    }
    return { row, kind: homeRoom ? 'over' : 'in', can: true, tag: livesTag, reason: null };
  });
  picked.sort(
    (a, b) =>
      RANK[a.kind] - RANK[b.kind] ||
      a.row.name.localeCompare(b.row.name) ||
      a.row.id.localeCompare(b.row.id),
  );
  return {
    room,
    title: RESIDENT_TEXT.pickerTitle(inSentence(room.name)),
    line: full ? RESIDENT_TEXT.full(room.name) : RESIDENT_TEXT.free(free),
    full,
    rows: picked,
  };
}

/**
 * The room a squishy moves into from the roster (#375's "Move into the
 * house"): the first room with a free bed, or the first room (the picker
 * then says it's full).
 */
export function roomFor(view: Pick<HouseView, 'rooms'>): string | null {
  const open = view.rooms.find((r) => r.residents.length < r.beds) ?? view.rooms[0];
  return open?.id ?? null;
}

/** A room's name from the house data, mid-sentence ("the Snug"), for a view with no house reply. */
export function roomNameOf(roomId: string): string {
  const name = HOUSE_DATA.levels.find((l) => l.room.id === roomId)?.room.name;
  return name ? inSentence(name) : 'your house';
}

/** The line after a move in: "Mochi moved into the Snug! 🏠". */
export function movedLine(view: Pick<HouseView, 'rooms'>, name: string, roomId: string): string {
  const room = view.rooms.find((r) => r.id === roomId);
  return RESIDENT_TEXT.moved(name, room ? inSentence(room.name) : 'your house');
}

/**
 * Who is drawn where, as one string: the scene places residents when it's
 * built, so a move (or one coming home from a job) rebuilds it.
 */
export function castKey(view: Pick<HouseView, 'rooms'>): string {
  return view.rooms
    .map(
      (r) => `${r.id}:${r.residents.map((x) => `${x.squishyId}${x.away ? '-' : '+'}`).join(',')}`,
    )
    .join('|');
}
