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
    const above = new Set(edgesOn(cellsOn(rooms, floor + 1)).map(edgeKey));
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
  };
}
