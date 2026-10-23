import type { CrookedHouse, EchoLoop, CrookedDoor } from '../schemas/data/crooked-house.js';

// The Crooked House's rules (#306 6b): pure, so the server decides with them
// and the client draws with them, and they can't drift. Progress is
// bitmasks over the data's list order (`far_hollow_state`,
// `far_hollow_rooms`); the house itself is `CROOKED_HOUSE`.

/** Is bit `index` set in `mask`? */
export function hasBit(mask: number, index: number): boolean {
  return index >= 0 && (mask & (1 << index)) !== 0;
}

/** `mask` with bit `index` set. */
export function withBit(mask: number, index: number): number {
  return mask | (1 << index);
}

/** How many bits of the lowest `size` are set. */
export function bitCount(mask: number, size: number): number {
  let n = 0;
  for (let i = 0; i < size; i++) if (hasBit(mask, i)) n += 1;
  return n;
}

/** Every one of the lowest `size` bits set. */
export function allBits(size: number): number {
  return size >= 31 ? 0x7fffffff : (1 << size) - 1;
}

/** What opens a house's doors: keys used (`unlocked`, by door) and powers used (`bonusOpen`, by door). */
export interface CrookedDoorsOpen {
  readonly unlocked: number;
  readonly bonusOpen: number;
}

/** Is a door open: no lock, or its key turned (`unlocked`), or its power used (`bonusOpen`)? */
export function doorOpen(house: CrookedHouse, door: CrookedDoor, open: CrookedDoorsOpen): boolean {
  const bit = house.doors.indexOf(door);
  if (door.key !== undefined) return hasBit(open.unlocked, bit);
  if (door.power !== undefined) return hasBit(open.bonusOpen, bit);
  return true;
}

/** The room on the other side of a door from `room`, or null if the door isn't in it. */
export function doorLeadsTo(door: CrookedDoor, room: string): string | null {
  if (door.a.room === room) return door.b.room;
  if (door.b.room === room) return door.a.room;
  return null;
}

/** The doors of a room. */
export function doorsOf(house: CrookedHouse, room: string): CrookedDoor[] {
  return house.doors.filter((d) => doorLeadsTo(d, room) !== null);
}

/** The door between two rooms, or null. */
export function doorBetween(house: CrookedHouse, a: string, b: string): CrookedDoor | null {
  return house.doors.find((d) => doorLeadsTo(d, a) === b) ?? null;
}

/** Every room reachable from the start through open doors (the start included). */
export function houseReach(house: CrookedHouse, open: CrookedDoorsOpen): Set<string> {
  const reached = new Set([house.start]);
  const queue = [house.start];
  for (let room = queue.shift(); room !== undefined; room = queue.shift()) {
    for (const door of doorsOf(house, room)) {
      const next = doorLeadsTo(door, room);
      if (next === null || reached.has(next) || !doorOpen(house, door, open)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/**
 * Every room reachable holding the first `held` keys of the chain, every
 * one turned and every power door open: what the chain lets a key hide in.
 */
export function reachWithKeys(house: CrookedHouse, held: number): Set<string> {
  const keys = new Set(house.keys.slice(0, held).map((k) => k.id));
  let unlocked = 0;
  house.doors.forEach((d, i) => {
    if (d.key !== undefined && keys.has(d.key)) unlocked = withBit(unlocked, i);
  });
  return houseReach(house, { unlocked, bonusOpen: allBits(house.doors.length) });
}

/**
 * A season's echo on its loop: where it starts (`offset`, a fraction of a
 * lap) and which way round it goes. From the season's seed
 * (`crookedHouseSecrets`), and sent to the client so it can draw it.
 */
export interface EchoPhase {
  readonly offset: number;
  readonly direction: 1 | -1;
}

/**
 * Where an echo is at `atMs` (epoch ms): a position along its loop in rooms,
 * in [0, rooms.length), where `i` is the middle of `rooms[i]` and it drifts
 * evenly from one room to the next. Pure: the client draws it at its clock,
 * the server checks it at its own.
 */
export function echoAt(loop: EchoLoop, phase: EchoPhase, atMs: number): number {
  const laps = phase.offset + (phase.direction * atMs) / 1000 / loop.periodSeconds;
  const frac = laps - Math.floor(laps);
  return frac * loop.rooms.length;
}

/** How far (in rooms, round the loop) an echo at `position` is from `room`; null if `room` isn't on it. */
export function echoDistance(loop: EchoLoop, position: number, room: string): number | null {
  const index = loop.rooms.indexOf(room);
  if (index < 0) return null;
  const n = loop.rooms.length;
  const d = Math.abs(position - index) % n;
  return Math.min(d, n - d);
}

/** An echo's reach: tiptoeing shrinks the lantern, so echoes notice half as far (owner decision 2). */
export function echoReach(loop: EchoLoop, tiptoe: boolean): number {
  return tiptoe ? loop.reach / 2 : loop.reach;
}

/**
 * Which echo catches a Keeper stepping into `room` at `atMs`, or null. An
 * echo never catches in a lit room (`lit`), so a room put right is safe
 * for good, and an echo whose rooms are all lit is gone.
 */
export function echoCatch(
  house: CrookedHouse,
  phases: Readonly<Record<string, EchoPhase>>,
  input: { room: string; atMs: number; tiptoe: boolean; lit: ReadonlySet<string> },
): EchoLoop | null {
  if (input.lit.has(input.room)) return null;
  for (const loop of house.echoLoops) {
    const phase = phases[loop.id];
    if (!phase) continue;
    const distance = echoDistance(loop, echoAt(loop, phase, input.atMs), input.room);
    if (distance !== null && distance <= echoReach(loop, input.tiptoe)) return loop;
  }
  return null;
}
