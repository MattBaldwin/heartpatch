import {
  CROOKED_HOUSE,
  doorOpen,
  doorsOf,
  type CrookedDoor,
  type CrookedHouse,
  type CrookedHouseView,
  type CrookedRoom,
  type CrookedSide,
  type CrookedThing,
} from '@heartpatch/shared';

// The Crooked House as the screen walks it (#306 6c), pure so every case is
// unit-tested. The house is `CROOKED_HOUSE` (shared data, rule 5); where I
// am, what's fixed and which doors are open come from the server's view
// (rule 1). This only works out where the Keeper may step, what's in front
// of it, and how the camera fits a room. Metres on each floor, x east, z
// north (the camera looks north).

export const CROOKED_WALK = {
  /** Walking speed, metres a second. */
  speed: 2.6, // TUNE
  /** Tiptoeing creeps. */
  tiptoeSpeed: 1.2, // TUNE
  /** How close the Keeper keeps to a wall. */
  margin: 0.42, // TUNE
  /** A doorway's walkable half-width (narrower than the gap, so the Keeper never clips its frame). */
  laneHalf: 0.42, // TUNE
  /** Past a wall this far into an open doorway, the Keeper steps through. */
  crossAt: 0.18, // TUNE
  /** A step into the next room lands this far in from its door. */
  arriveIn: 0.85, // TUNE
  /** The action button names a thing this close (metres, from its middle). */
  reach: 1.5, // TUNE
  /** …and a shut door this close. */
  doorReach: 1.4, // TUNE
  /** A tap within this of a thing walks up beside it (metres). */
  tapPick: 0.9, // TUNE
  /** A doorway is this wide (the kit's gap). */
  doorWidth: 1.3,
} as const;

/** The lantern's circle of light, metres (the design: about three metres across). */
export const CROOKED_LANTERN = {
  radius: 1.6, // TUNE
  /** Tiptoe shrinks it to a small ring (owner decision 2). */
  tiptoe: 0.85, // TUNE
} as const;

export interface FloorPoint {
  x: number;
  z: number;
}

const HOUSE: CrookedHouse = CROOKED_HOUSE;
const ROOMS = new Map(HOUSE.rooms.map((r) => [r.id, r]));

export function roomOf(id: string): CrookedRoom | null {
  return ROOMS.get(id) ?? null;
}

/** The rooms on a floor, in the data's order. */
export function roomsOn(floor: number): CrookedRoom[] {
  return HOUSE.rooms.filter((r) => r.floor === floor);
}

/** The floors the house has, lowest first. */
export function floors(): number[] {
  return [...new Set(HOUSE.rooms.map((r) => r.floor))].sort((a, b) => a - b);
}

/** The lit rooms (as the server lights them): the bonus rooms, the attic, and every main room that bloomed. */
export function litRooms(view: Pick<CrookedHouseView, 'rooms'>): Set<string> {
  const bloomed = new Set(view.rooms.filter((r) => r.bloomed).map((r) => r.id));
  return new Set(
    HOUSE.rooms.filter((r) => r.kind !== 'main' || bloomed.has(r.id)).map((r) => r.id),
  );
}

/** The things of a room still crooked, in the data's order. */
export function crookedThings(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms'>,
): CrookedThing[] {
  const fixed = new Set(view.rooms.find((r) => r.id === room.id)?.fixed ?? []);
  return room.things.filter((t) => !fixed.has(t.id));
}

/** How a door stands for me: open, locked (and whether I hold its key), or asleep behind a power. */
export type DoorState =
  | { readonly kind: 'open' }
  | { readonly kind: 'locked'; readonly key: string; readonly held: boolean }
  | { readonly kind: 'sleeping'; readonly power: string; readonly sleeper: string };

const bitsOf = (ids: readonly string[]): number =>
  HOUSE.doors.reduce((mask, d, i) => (ids.includes(d.id) ? mask | (1 << i) : mask), 0);

export function doorState(
  door: CrookedDoor,
  view: Pick<CrookedHouseView, 'unlocked' | 'bonusOpen' | 'keys'>,
): DoorState {
  if (
    doorOpen(HOUSE, door, { unlocked: bitsOf(view.unlocked), bonusOpen: bitsOf(view.bonusOpen) })
  ) {
    return { kind: 'open' };
  }
  if (door.key !== undefined)
    return { kind: 'locked', key: door.key, held: view.keys.includes(door.key) };
  return { kind: 'sleeping', power: door.power ?? '', sleeper: door.sleeper ?? '' };
}

/** A door's end in one room: the room, the wall, and where along it. */
export interface DoorEnd {
  readonly room: CrookedRoom;
  readonly side: CrookedSide;
  /** Metres along the wall from its middle (x for n/s walls, z for e/w). */
  readonly at: number;
  /** The doorway's middle on the wall, floor metres. */
  readonly point: FloorPoint;
  /** Into the room, a unit step. */
  readonly inward: FloorPoint;
}

const INWARD: Record<CrookedSide, FloorPoint> = {
  n: { x: 0, z: -1 },
  s: { x: 0, z: 1 },
  e: { x: -1, z: 0 },
  w: { x: 1, z: 0 },
};

/** Where a wall's point `at` along it is, on the floor. */
export function wallPoint(room: CrookedRoom, side: CrookedSide, at: number): FloorPoint {
  const { x, z, w, d } = room.box;
  if (side === 'n') return { x: x + at, z: z + d / 2 };
  if (side === 's') return { x: x + at, z: z - d / 2 };
  if (side === 'e') return { x: x + w / 2, z: z + at };
  return { x: x - w / 2, z: z + at };
}

/** A door's end in `roomId` (or null if it isn't one of its doors). */
export function doorEnd(door: CrookedDoor, roomId: string): DoorEnd | null {
  const end = door.a.room === roomId ? door.a : door.b.room === roomId ? door.b : null;
  const room = end ? roomOf(end.room) : null;
  if (!end || !room) return null;
  return {
    room,
    side: end.side,
    at: end.at,
    point: wallPoint(room, end.side, end.at),
    inward: INWARD[end.side],
  };
}

/** The other end of a door from `roomId`. */
export function farEnd(door: CrookedDoor, roomId: string): DoorEnd | null {
  const other = door.a.room === roomId ? door.b.room : door.b.room === roomId ? door.a.room : null;
  return other === null ? null : doorEnd(door, other);
}

/** Where a step through `door` into `roomId` lands: a little in from its end there. */
export function arrivalSpot(door: CrookedDoor, roomId: string): FloorPoint | null {
  const end = doorEnd(door, roomId);
  if (!end) return null;
  return {
    x: end.point.x + end.inward.x * CROOKED_WALK.arriveIn,
    z: end.point.z + end.inward.z * CROOKED_WALK.arriveIn,
  };
}

/** Where the Keeper stands in a room it arrives in without a door (a reload, the map): its middle, a little south. */
export function roomStart(room: CrookedRoom): FloorPoint {
  return { x: room.box.x, z: room.box.z - room.box.d * 0.15 };
}

/** One step's outcome: where the Keeper ends up, and a doorway it stepped through or bumped. */
export interface WalkResult {
  readonly at: FloorPoint;
  /** Through an open doorway: the screen asks the server to `enter` the room beyond. */
  readonly crossed: CrookedDoor | null;
  /** Into a shut doorway (locked or asleep): the bubble says why. */
  readonly bumped: CrookedDoor | null;
}

/**
 * The Keeper steps from `from` toward `to` in `room`: kept inside its walls
 * (`margin` off them), except in a doorway's lane, where an open door lets
 * it reach the wall and step through, and a shut one stops it.
 */
export function walkStep(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'unlocked' | 'bonusOpen' | 'keys'>,
  to: FloorPoint,
): WalkResult {
  const { x, z, w, d } = room.box;
  const m = CROOKED_WALK.margin;
  const lim = { w: x - w / 2, e: x + w / 2, s: z - d / 2, n: z + d / 2 };
  let px = Math.min(lim.e - m, Math.max(lim.w + m, to.x));
  let pz = Math.min(lim.n - m, Math.max(lim.s + m, to.z));
  let crossed: CrookedDoor | null = null;
  let bumped: CrookedDoor | null = null;
  for (const door of doorsOf(HOUSE, room.id)) {
    const end = doorEnd(door, room.id);
    if (!end) continue;
    const across = end.side === 'n' || end.side === 's';
    const along = across ? to.x - end.point.x : to.z - end.point.z;
    if (Math.abs(along) > CROOKED_WALK.laneHalf) continue;
    // How far past the margin, toward this wall, the step wants to go.
    const past =
      end.side === 'n'
        ? to.z - (lim.n - m)
        : end.side === 's'
          ? lim.s + m - to.z
          : end.side === 'e'
            ? to.x - (lim.e - m)
            : lim.w + m - to.x;
    if (past <= 0) continue;
    if (doorState(door, view).kind !== 'open') {
      bumped = door;
      continue;
    }
    const depth = Math.min(past, m + CROOKED_WALK.crossAt + 0.05);
    if (end.side === 'n') pz = lim.n - m + depth;
    else if (end.side === 's') pz = lim.s + m - depth;
    else if (end.side === 'e') px = lim.e - m + depth;
    else px = lim.w + m - depth;
    if (across) px = to.x;
    else pz = to.z;
    if (past >= m + CROOKED_WALK.crossAt) crossed = door;
  }
  return { at: { x: px, z: pz }, crossed, bumped };
}

/** What's in front of the Keeper: the nearest crooked thing, or a shut door, within reach. */
export type CrookedTarget =
  | { readonly kind: 'thing'; readonly thing: CrookedThing; readonly at: FloorPoint }
  | {
      readonly kind: 'door';
      readonly door: CrookedDoor;
      readonly state: DoorState;
      readonly at: FloorPoint;
    };

/** Where a thing stands on the floor. */
export function thingPoint(room: CrookedRoom, thing: CrookedThing): FloorPoint {
  return { x: room.box.x + thing.at[0], z: room.box.z + thing.at[1] };
}

export function nearestTarget(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms' | 'unlocked' | 'bonusOpen' | 'keys'>,
  at: FloorPoint,
): CrookedTarget | null {
  let best: CrookedTarget | null = null;
  let bestD = Infinity;
  for (const thing of crookedThings(room, view)) {
    const p = thingPoint(room, thing);
    const dist = Math.hypot(p.x - at.x, p.z - at.z);
    if (dist <= CROOKED_WALK.reach && dist < bestD) {
      best = { kind: 'thing', thing, at: p };
      bestD = dist;
    }
  }
  for (const door of doorsOf(HOUSE, room.id)) {
    const state = doorState(door, view);
    const end = doorEnd(door, room.id);
    if (state.kind === 'open' || !end) continue;
    const dist = Math.hypot(end.point.x - at.x, end.point.z - at.z);
    if (dist <= CROOKED_WALK.doorReach && dist < bestD) {
      best = { kind: 'door', door, state, at: end.point };
      bestD = dist;
    }
  }
  return best;
}

/** A tap on the floor at `p`: a crooked thing near it walks up beside it, else straight there. */
export function tapGoal(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'rooms'>,
  keeper: FloorPoint,
  p: FloorPoint,
): FloorPoint {
  for (const thing of crookedThings(room, view)) {
    const t = thingPoint(room, thing);
    if (Math.hypot(t.x - p.x, t.z - p.z) > CROOKED_WALK.tapPick) continue;
    // Beside it, on the Keeper's side, an arm's length off.
    const dx = keeper.x - t.x;
    const dz = keeper.z - t.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: t.x + (dx / l) * 0.9, z: t.z + (dz / l) * 0.9 };
  }
  return p;
}

/** The room the server says I'm in should be on the floor shown; else the floor it's on. */
export function floorOf(roomId: string): number {
  return roomOf(roomId)?.floor ?? 0;
}

/** A box on the floor, metres. */
export interface FloorBox {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

/** Every room on a floor, as one box. */
export function floorBox(floor: number): FloorBox {
  const rooms = roomsOn(floor);
  const minX = Math.min(...rooms.map((r) => r.box.x - r.box.w / 2));
  const maxX = Math.max(...rooms.map((r) => r.box.x + r.box.w / 2));
  const minZ = Math.min(...rooms.map((r) => r.box.z - r.box.d / 2));
  const maxZ = Math.max(...rooms.map((r) => r.box.z + r.box.d / 2));
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

/** A camera shot: looking north at `target`, down by `pitch`, from `distance` away. */
export interface CrookedShot {
  readonly target: FloorPoint;
  readonly pitch: number;
  readonly distance: number;
}

export const CROOKED_CAMERA = {
  /** Top-down with a slight tilt (design doc §20). */
  pitch: (56 * Math.PI) / 180, // TUNE
  /** The dollhouse map looks more straight down. */
  mapPitch: (72 * Math.PI) / 180, // TUNE
  /** Room round a fitted room, metres. */
  margin: 0.5, // TUNE
  /** …and round the whole floor on the map (its near rooms look wider than its middle). */
  mapMargin: 2.6, // TUNE
  /** The far wall's height shows above the floor. */
  wallHeight: 2.3,
} as const;

/**
 * The shot that fits `box` in the screen's free band: `aspect` is width over
 * height, `fov` the camera's vertical field of view, and `top` / `bottom`
 * the shares of the screen's height the HUD covers. Pure, for any phone.
 */
export function fitShot(
  box: FloorBox,
  view: { aspect: number; fov: number; top: number; bottom: number },
  pitch: number = CROOKED_CAMERA.pitch,
  margin: number = CROOKED_CAMERA.margin,
): CrookedShot {
  const tanV = Math.tan(view.fov / 2);
  const tanH = tanV * Math.max(0.1, view.aspect);
  const free = Math.max(0.2, 1 - view.top - view.bottom);
  // Across: the room's width at its middle.
  const across = (box.w / 2 + margin) / tanH;
  // Up the screen: the floor's depth foreshortened, and the far wall standing up.
  const tall =
    (box.d * Math.sin(pitch)) / 2 + (CROOKED_CAMERA.wallHeight * Math.cos(pitch)) / 2 + margin;
  const up = tall / (tanV * free);
  const distance = Math.max(across, up);
  // The free band's middle sits above (or below) the screen's: aim off the
  // room's middle so the room lands in it. Up the screen by `lift` (a share
  // of half the screen's height) is that much further north on the floor.
  const lift = view.bottom - view.top;
  const north = (lift * distance * tanV) / Math.sin(pitch);
  // The far wall stands up into the frame: aim a little north of the floor's middle.
  const wall = (CROOKED_CAMERA.wallHeight * Math.cos(pitch)) / 4;
  return { target: { x: box.x, z: box.z - north + wall }, pitch, distance };
}
