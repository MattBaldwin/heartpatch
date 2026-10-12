import type { HouseDoor, HouseRoomLayout, HouseRoomLook } from '@heartpatch/shared';
import { HOUSE_DOORS, HOUSE_GRID, HOUSE_WINDOWS } from './house-config.js';

/*
 * Where the house's rooms and walls stand (#381 plan §1c), worked out from
 * the rooms' grid layouts alone: pure, no Babylon, so it's unit-tested. The
 * code never names a level or a room: a later level adds rooms and floors
 * by data edit.
 *
 * World units are metres. x runs right and z away from the dollhouse front
 * (the grid's +gy), y is up; the grid's origin cell's front-left corner is
 * the world origin. The dollhouse camera looks along +z.
 */

/** A room as the layout places it. */
export interface RoomInput {
  readonly id: string;
  readonly look: HouseRoomLook;
  readonly beds: number;
  readonly layout: HouseRoomLayout;
}

/** A room's box in metres (inside faces of its walls on the grid lines). */
export interface RoomBox {
  readonly id: string;
  readonly look: HouseRoomLook;
  readonly beds: number;
  readonly door: HouseDoor;
  readonly floor: number;
  readonly storeys: number;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Its floor's height, and the top of its last storey. */
  readonly y0: number;
  readonly y1: number;
}

export interface HouseBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** A hole in a wall run: its centre along the run (from its start) and above its foot. */
export interface WallHole {
  readonly u: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A straight piece of wall on one floor. `axis` is the direction it runs:
 * `x` walls face the camera (front or back), `z` walls run away from it.
 */
export interface WallRun {
  readonly floor: number;
  readonly axis: 'x' | 'z';
  /** The fixed coordinate (z for an `x` wall, x for a `z` wall), metres. */
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly y0: number;
  readonly height: number;
  /** No room on the other side: the outside of the house. */
  readonly exterior: boolean;
  /** Which side of `room` it is. */
  readonly side: HouseDoor;
  /** The room whose wall it is (for an inside wall: the room behind or to its west). */
  readonly room: string;
  /** The room on the other side, if any. */
  readonly other: string | null;
  /**
   * It stands between the camera and `room` (a south side): taken off the
   * dollhouse when it's the outside, cut low when it's inside.
   */
  readonly front: boolean;
  /** Nothing stands on it (its top edge shows, capped in dark wood). */
  readonly top: boolean;
  readonly doors: readonly WallHole[];
  readonly windows: readonly WallHole[];
  /**
   * The floor of the rooms standing on its top edge when they all start
   * above it (null when nothing does, or its own room goes on up): the
   * floor cut takes those away, so its top edge gets a dark cap.
   */
  readonly upper: number | null;
}

const { cell, storey, wall, frontLip } = HOUSE_GRID;

export function roomBox(room: RoomInput): RoomBox {
  const { floor, gx, gy, w, d, storeys, door } = room.layout;
  return {
    id: room.id,
    look: room.look,
    beds: room.beds,
    door,
    floor,
    storeys,
    x0: gx * cell,
    x1: (gx + w) * cell,
    z0: gy * cell,
    z1: (gy + d) * cell,
    y0: floor * storey,
    y1: (floor + storeys) * storey,
  };
}

/** The box round the whole house, walls and the floor's front lip included. */
export function houseBounds(rooms: readonly RoomBox[]): HouseBounds {
  if (rooms.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  return {
    minX: Math.min(...rooms.map((r) => r.x0)) - wall,
    maxX: Math.max(...rooms.map((r) => r.x1)) + wall,
    minY: 0,
    maxY: Math.max(...rooms.map((r) => r.y1)),
    minZ: Math.min(...rooms.map((r) => r.z0)) - frontLip,
    maxZ: Math.max(...rooms.map((r) => r.z1)) + wall,
  };
}

/** Which room fills each grid cell on a floor (`x:y` → room id). */
function cellsOn(rooms: readonly RoomInput[], floor: number): Map<string, string> {
  const cells = new Map<string, string>();
  for (const room of rooms) {
    const l = room.layout;
    if (floor < l.floor || floor >= l.floor + l.storeys) continue;
    for (let x = l.gx; x < l.gx + l.w; x += 1)
      for (let y = l.gy; y < l.gy + l.d; y += 1) cells.set(`${String(x)}:${String(y)}`, room.id);
  }
  return cells;
}

interface Edge {
  /** `h`: along x at grid line `line` (z); `v`: along z at grid line `line` (x). */
  readonly kind: 'h' | 'v';
  readonly line: number;
  /** The cell index along the edge. */
  readonly step: number;
  readonly room: string;
  readonly other: string | null;
  readonly side: HouseDoor;
}

/** Every grid edge on a floor that has a wall: between two rooms, or a room and outside. */
function edgesOn(cells: ReadonlyMap<string, string>): Edge[] {
  const at = (x: number, y: number) => cells.get(`${String(x)}:${String(y)}`) ?? null;
  const edges: Edge[] = [];
  for (const [key, room] of cells) {
    const [xs, ys] = key.split(':');
    const x = Number(xs);
    const y = Number(ys);
    // Each inside edge once: kept by the room behind it (h) or to its west (v).
    const south = at(x, y - 1);
    if (south !== room)
      edges.push({ kind: 'h', line: y, step: x, room, other: south, side: 'south' });
    const north = at(x, y + 1);
    if (north === null)
      edges.push({ kind: 'h', line: y + 1, step: x, room, other: null, side: 'north' });
    const west = at(x - 1, y);
    if (west === null) edges.push({ kind: 'v', line: x, step: y, room, other: null, side: 'west' });
    const east = at(x + 1, y);
    if (east !== room)
      edges.push({ kind: 'v', line: x + 1, step: y, room, other: east, side: 'east' });
  }
  return edges;
}

const edgeKey = (e: Pick<Edge, 'kind' | 'line' | 'step'>) =>
  `${e.kind}:${String(e.line)}:${String(e.step)}`;

/**
 * Every wall run of the house, floor by floor: consecutive grid edges with
 * the same rooms on both sides join into one run. Doors go where a room's
 * `door` says (in the middle of that side), windows on long enough outside
 * runs at the back and on the right (the left keeps the hearth's wall).
 */
export function wallRuns(rooms: readonly RoomInput[]): WallRun[] {
  if (rooms.length === 0) return [];
  const top = Math.max(...rooms.map((r) => r.layout.floor + r.layout.storeys));
  const boxes = new Map(rooms.map((r) => [r.id, roomBox(r)]));
  const runs: WallRun[] = [];
  for (let floor = 0; floor < top; floor += 1) {
    const edges = edgesOn(cellsOn(rooms, floor));
    const upstairs = edgesOn(cellsOn(rooms, floor + 1));
    const above = new Set(upstairs.map(edgeKey));
    const starts = new Map(rooms.map((r) => [r.id, r.layout.floor]));
    // Which floor the room whose wall stands on each edge upstairs starts on.
    const aboveFloor = new Map(upstairs.map((e) => [edgeKey(e), starts.get(e.room) ?? 0]));
    // Join neighbours along each grid line.
    const groups = new Map<string, Edge[]>();
    for (const e of edges) {
      const key = `${e.kind}:${String(e.line)}:${e.room}:${e.other ?? '-'}:${e.side}`;
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.step - b.step);
      let start = 0;
      for (let i = 1; i <= list.length; i += 1) {
        const prev = list[i - 1];
        const next = list[i];
        if (next && prev && next.step === prev.step + 1) continue;
        const run = list.slice(start, i);
        start = i;
        const first = run[0];
        const last = run.at(-1);
        if (!first || !last) continue;
        runs.push(
          makeRun(
            floor,
            run,
            first,
            last,
            above,
            aboveFloor,
            boxes.get(first.room),
            boxes.get(first.other ?? ''),
          ),
        );
      }
    }
  }
  return runs.sort(
    (a, b) => a.floor - b.floor || a.axis.localeCompare(b.axis) || a.at - b.at || a.from - b.from,
  );
}

function makeRun(
  floor: number,
  run: readonly Edge[],
  first: Edge,
  last: Edge,
  above: ReadonlySet<string>,
  aboveFloor: ReadonlyMap<string, number>,
  box: RoomBox | undefined,
  otherBox: RoomBox | undefined,
): WallRun {
  const axis = first.kind === 'h' ? 'x' : 'z';
  const from = first.step * cell;
  const to = (last.step + 1) * cell;
  const exterior = first.other === null;
  const front = first.side === 'south';
  const holes: WallHole[] = [];
  // A door where the room (or its neighbour across an inside wall) says.
  const facing: HouseDoor =
    first.side === 'south' ? 'north' : first.side === 'east' ? 'west' : first.side;
  const doorSpan = (b: RoomBox): [number, number] => (axis === 'x' ? [b.x0, b.x1] : [b.z0, b.z1]);
  const doorOn = (b: RoomBox | undefined, side: HouseDoor) =>
    b !== undefined && b.door === side && floor === b.floor ? doorSpan(b) : null;
  const span = doorOn(box, first.side) ?? (exterior ? null : doorOn(otherBox, facing));
  if (span) {
    const mid = Math.min(
      Math.max((span[0] + span[1]) / 2, from + HOUSE_DOORS.width / 2),
      to - HOUSE_DOORS.width / 2,
    );
    holes.push({
      u: mid - from,
      y: HOUSE_DOORS.height / 2,
      w: HOUSE_DOORS.width,
      h: HOUSE_DOORS.height,
    });
  }
  const windows: WallHole[] = [];
  const length = to - from;
  const windowSide = first.side === 'north' || first.side === 'east';
  if (exterior && windowSide && run.length >= HOUSE_WINDOWS.minRun && holes.length === 0) {
    const { width, height, sill } = HOUSE_WINDOWS;
    windows.push({ u: length / 2, y: sill + height / 2, w: width, h: height });
  }
  return {
    floor,
    axis,
    at: first.line * cell,
    from,
    to,
    y0: floor * storey,
    height: storey,
    exterior,
    side: first.side,
    room: first.room,
    other: first.other,
    front,
    top: !run.every((e) => above.has(edgeKey(e))),
    doors: holes,
    windows,
    upper: run.every((e) => (aboveFloor.get(edgeKey(e)) ?? floor) > floor) ? floor + 1 : null,
  };
}

// ── The floor cut (plan §1c) ─────────────────────────────────────────

/**
 * The floors the dollhouse can show, bottom up: every floor a room starts
 * on. A room that spans storeys (the Heart Hall) counts on its first.
 */
export function houseFloors(rooms: readonly Pick<RoomBox, 'floor'>[]): number[] {
  return [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
}

/**
 * The floor a wall run goes with for the cut: the higher of its two rooms'
 * first floors. A wall between the Heart Hall (floor 0) and the Kitchen
 * (floor 1) is only there because of the Kitchen, so it goes with it.
 */
export function runFloor(run: Pick<WallRun, 'room' | 'other'>, rooms: readonly RoomBox[]): number {
  const floorOf = (id: string | null) => rooms.find((r) => r.id === id)?.floor ?? 0;
  return Math.max(floorOf(run.room), floorOf(run.other));
}

/** Whether room `o` stands over room `r` (on or above its top, their footprints overlapping). */
export const covers = (o: RoomBox, r: RoomBox): boolean =>
  o !== r && o.y0 >= r.y1 && o.x0 < r.x1 && o.x1 > r.x0 && o.z0 < r.z1 && o.z1 > r.z0;

/** What the dollhouse shows at one floor. */
export interface FloorCut {
  /** The floor shown (the nearest of the house's floors at or below the one asked for). */
  readonly floor: number;
  /** Rooms drawn: every room starting on this floor or below it. */
  readonly shown: ReadonlySet<string>;
  /**
   * Rooms whose residents are drawn: every shown room with no shown room
   * over it (plan §1c: residents on other floors are not drawn; the Snug's
   * are under the Kitchen's floor upstairs, the Playroom's in the open).
   */
  readonly cast: ReadonlySet<string>;
  /** The box round the shown rooms. */
  readonly bounds: HouseBounds;
}

/**
 * The floor cut (plan §1c `floorCut`): the dollhouse shows one floor with
 * every floor above it taken away, so its rooms lie open to the camera.
 * Anything tagged with a floor (a room's pieces, a wall, a bed) is drawn
 * while `shownAt(tag, cut.floor)`.
 */
export function floorCut(rooms: readonly RoomBox[], floor: number): FloorCut {
  const floors = houseFloors(rooms);
  const at = floors.filter((f) => f <= floor).at(-1) ?? floors[0] ?? 0;
  const shown = rooms.filter((r) => r.floor <= at);
  return {
    floor: at,
    shown: new Set(shown.map((r) => r.id)),
    cast: new Set(shown.filter((r) => !shown.some((o) => covers(o, r))).map((r) => r.id)),
    bounds: houseBounds(shown),
  };
}

/** Whether something on floor `tag` is drawn while the dollhouse shows `floor`. */
export const shownAt = (tag: number, floor: number): boolean => tag <= floor;

/**
 * The floor the dollhouse shows once the house has grown to `level`: the
 * new room's when it starts above the floor shown (the Kitchen, upstairs at
 * level 3, would be cut away), else the floor shown (a room below it, like
 * the two-storey Heart Hall, is in view either way).
 */
export function floorAfterGrowing(
  rooms: readonly { readonly level: number; readonly layout: Pick<HouseRoomLayout, 'floor'> }[],
  level: number,
  shown: number,
): number {
  const added = rooms.find((r) => r.level === level);
  return added && added.layout.floor > shown ? added.layout.floor : shown;
}
