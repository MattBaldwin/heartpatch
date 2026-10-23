import {
  CROOKED_HOUSE,
  doorBetween,
  echoAt,
  echoCatch,
  type CrookedDoor,
  type CrookedHouseView,
  type EchoPhase,
} from '@heartpatch/shared';
import { faceYaw } from '../../procedural/face-yaw.js';
import { doorEnd, doorState, litRooms, roomOf, type FloorPoint } from './crooked-plan.js';

// The Crooked House's echoes (#306 6d), pure: where each one drifts now
// (`echoAt` on the server's clock, the shared rule the server catches
// with), how brightly it shows (an echo shies away from a lit room), and
// whether one is close enough to the room past a doorway to notice me
// stepping in (`echoCatch`, the server's own check, so the hint and the
// catch agree). Tiptoe halves an echo's reach (owner decision 2).

export const CROOKED_ECHO = {
  /** Near a doorway into a dark room, closer than this (metres), the Keeper hears what's past it. */
  hearDoor: 1.5, // TUNE
  /** How far from its room's middle an echo starts to fade going into a lit room (share of the way). */
  fade: [0.35, 0.65] as const, // TUNE
  /** The share of the way from one room's middle to the next spent in the doorway between. */
  doorway: 0.1, // TUNE
} as const;

const LOOPS = new Map(CROOKED_HOUSE.echoLoops.map((l) => [l.id, l]));

/** The season's echo phases from the view, by loop id. */
export function echoPhases(
  view: Pick<CrookedHouseView, 'echoes'>,
): Readonly<Record<string, EchoPhase>> {
  const phases: Record<string, EchoPhase> = {};
  for (const e of view.echoes) phases[e.loop] = { offset: e.offset, direction: e.direction };
  return phases;
}

/** Where an echo is drawn: its floor point, the room it's nearest, and how much of it shows (0–1). */
export interface EchoSpot {
  readonly loop: string;
  readonly position: number;
  readonly room: string;
  /** The two rooms it drifts between now (it shows if either is drawn). */
  readonly between: readonly [string, string];
  readonly floor: number;
  readonly at: FloorPoint;
  /** Which way it drifts, as a yaw (0 faces −z, the camera). */
  readonly heading: number;
  /** 0 hidden (in the light) to 1 fully there. */
  readonly shown: number;
  /** Every room of its loop is put right: it's gone for good. */
  readonly gone: boolean;
}

/**
 * Every echo where it drifts at `atMs` (the server's clock): from the middle
 * of one room to the next through the doorway between them, so an echo
 * drawn by a room's middle is one that would notice me stepping in there.
 */
export function echoSpots(
  view: Pick<CrookedHouseView, 'echoes' | 'rooms' | 'unlocked' | 'bonusOpen'>,
  atMs: number,
): EchoSpot[] {
  const lit = litRooms(view);
  const spots: EchoSpot[] = [];
  for (const e of view.echoes) {
    const loop = LOOPS.get(e.loop);
    if (!loop) continue;
    const position = echoAt(loop, e, atMs);
    const i = Math.floor(position) % loop.rooms.length;
    const t = position - Math.floor(position);
    const fromId = loop.rooms[i];
    const toId = loop.rooms[(i + 1) % loop.rooms.length];
    const from = fromId === undefined ? null : roomOf(fromId);
    const to = toId === undefined ? null : roomOf(toId);
    if (!from || !to) continue;
    const path = echoPath(from.id, to.id);
    const at = alongPath(path, t);
    const ahead = alongPath(path, Math.min(1, t + 0.02));
    const back = alongPath(path, Math.max(0, t - 0.02));
    const drift =
      e.direction === 1
        ? { x: ahead.x - back.x, z: ahead.z - back.z }
        : { x: back.x - ahead.x, z: back.z - ahead.z };
    const near = t < 0.5 ? from : to;
    const [f0, f1] = CROOKED_ECHO.fade;
    const k = smooth(f0, f1, t);
    const dark = (id: string) => (lit.has(id) ? 0 : 1);
    spots.push({
      loop: loop.id,
      position,
      room: near.id,
      between: [from.id, to.id],
      floor: near.floor,
      at,
      heading: faceYaw(drift.x, drift.z),
      shown: dark(from.id) * (1 - k) + dark(to.id) * k,
      gone: loop.rooms.every((r) => lit.has(r)),
    });
  }
  return spots;
}

/** An echo's way from one room's middle to the next: through their doorway when they share one. */
function echoPath(from: string, to: string): FloorPoint[] {
  const a = roomOf(from);
  const b = roomOf(to);
  if (!a || !b) return [];
  const mid = (r: typeof a): FloorPoint => ({ x: r.box.x, z: r.box.z });
  const door = doorBetween(CROOKED_HOUSE, from, to);
  const da = door ? doorEnd(door, from) : null;
  const db = door ? doorEnd(door, to) : null;
  return da && db ? [mid(a), da.point, db.point, mid(b)] : [mid(a), mid(b)];
}

/**
 * The point a share `t` of the way along an echo's path. Through a
 * doorway, the room's middle to its door takes the first half (less the
 * doorway's own share), so the echo crosses the threshold just as the room
 * it's nearest changes; a straight path is even.
 */
function alongPath(path: readonly FloorPoint[], t: number): FloorPoint {
  const first = path[0];
  if (!first) return { x: 0, z: 0 };
  const d = CROOKED_ECHO.doorway / 2;
  const marks =
    path.length === 4
      ? [0, 0.5 - d, 0.5 + d, 1]
      : path.map((_, i) => i / Math.max(1, path.length - 1));
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < path.length; i++) {
    const a = marks[i - 1] ?? 0;
    const b = marks[i] ?? 1;
    if (x > b && i < path.length - 1) continue;
    const p = path[i - 1] ?? first;
    const q = path[i] ?? first;
    const k = b > a ? Math.min(1, Math.max(0, (x - a) / (b - a))) : 1;
    return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k };
  }
  return { ...first };
}

function smooth(a: number, b: number, t: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** What the Keeper hears at a doorway into a dark room: an echo close by in there, or not. */
export interface EchoHint {
  readonly door: CrookedDoor;
  readonly room: string;
  /** The echo that would notice me stepping in now, as I am (tiptoeing or not); null if none. */
  readonly watching: string | null;
  /** The echo that would notice me walking in, and tiptoeing in (Tiptoe halves its reach). */
  readonly plain: string | null;
  readonly soft: string | null;
}

/**
 * The nearest open doorway of my room into a dark room, within
 * `CROOKED_ECHO.hearDoor`, and whether an echo past it would catch me
 * stepping through now: the server's `echoCatch` on the client's copy of
 * its clock. The server decides; this only tells the Keeper to wait.
 */
export function echoHint(
  view: Pick<CrookedHouseView, 'room' | 'echoes' | 'rooms' | 'unlocked' | 'bonusOpen' | 'keys'>,
  keeper: FloorPoint,
  atMs: number,
  tiptoe: boolean,
): EchoHint | null {
  const lit = litRooms(view);
  let best: { door: CrookedDoor; room: string; d: number } | null = null;
  for (const door of CROOKED_HOUSE.doors) {
    const other =
      door.a.room === view.room ? door.b.room : door.b.room === view.room ? door.a.room : null;
    if (other === null || lit.has(other)) continue;
    if (doorState(door, view).kind !== 'open') continue;
    const end = doorEnd(door, view.room);
    if (!end) continue;
    const d = Math.hypot(end.point.x - keeper.x, end.point.z - keeper.z);
    if (d > CROOKED_ECHO.hearDoor || (best && best.d <= d)) continue;
    best = { door, room: other, d };
  }
  if (!best) return null;
  const phases = echoPhases(view);
  const catchAt = (soft: boolean) =>
    echoCatch(CROOKED_HOUSE, phases, { room: best.room, atMs, tiptoe: soft, lit })?.id ?? null;
  const plain = catchAt(false);
  const soft = catchAt(true);
  return { door: best.door, room: best.room, watching: tiptoe ? soft : plain, plain, soft };
}

/**
 * The server's clock as the client keeps it: the gap between the view's
 * `serverTime` and the moment it arrived, so echoes drift where the server
 * sees them. It runs behind by the reply's trip (a tenth of a second or
 * so, a hundredth of a room): fine, as the hint is only advice.
 */
export function serverClock(serverTime: string, receivedAt: number): (now: number) => number {
  const skew = Date.parse(serverTime) - receivedAt;
  return (now) => now + (Number.isFinite(skew) ? skew : 0);
}
