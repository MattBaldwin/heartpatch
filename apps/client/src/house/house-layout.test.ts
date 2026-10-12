import { HOUSE_DATA, roomsAt } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HOUSE_GRID } from './house-config.js';
import {
  covers,
  floorCut,
  houseBounds,
  houseFloors,
  roomBox,
  runFloor,
  shownAt,
  wallRuns,
} from './house-layout.js';

const { cell, storey, wall, frontLip } = HOUSE_GRID;
const top = HOUSE_DATA.levels.length;

describe('house layout', () => {
  it('places a room from its grid layout, in metres', () => {
    const [snug] = roomsAt(HOUSE_DATA, 1);
    const box = roomBox(snug!);
    expect(box).toMatchObject({ x0: 0, x1: 3 * cell, z0: 0, z1: 3 * cell, y0: 0, y1: storey });
  });

  it('bounds the house with its walls and the floor’s lip at the open front', () => {
    const b = houseBounds(roomsAt(HOUSE_DATA, 1).map(roomBox));
    expect(b).toEqual({
      minX: -wall,
      maxX: 3 * cell + wall,
      minY: 0,
      maxY: storey,
      minZ: -frontLip,
      maxZ: 3 * cell + wall,
    });
  });

  it('gives a one-room house four outside walls, the front facing the camera', () => {
    const runs = wallRuns(roomsAt(HOUSE_DATA, 1));
    expect(runs.map((r) => r.side).sort()).toEqual(['east', 'north', 'south', 'west']);
    expect(runs.every((r) => r.exterior && r.top)).toBe(true);
    expect(runs.filter((r) => r.front).map((r) => r.side)).toEqual(['south']);
  });

  it('puts the door where the room says and windows at the back and on the right', () => {
    const runs = wallRuns(roomsAt(HOUSE_DATA, 1));
    const side = (s: string) => runs.find((r) => r.side === s)!;
    expect(side('south').doors).toHaveLength(1); // the Snug's door is at the front
    expect(side('north').windows).toHaveLength(1);
    expect(side('east').windows).toHaveLength(1);
    expect(side('west').windows).toHaveLength(0); // the hearth's wall
  });

  it('joins rooms with inside walls, once each, and stacks floors', () => {
    const rooms = roomsAt(HOUSE_DATA, top);
    const runs = wallRuns(rooms);
    const inside = runs.filter((r) => !r.exterior);
    // No grid edge has two walls on it.
    const keys = runs.map((r) => `${String(r.floor)}:${r.axis}:${String(r.at)}:${String(r.from)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(inside.length).toBeGreaterThan(0);
    // An inside wall that faces the camera is cut low in the dollhouse (front), not taken off.
    expect(inside.some((r) => r.front)).toBe(true);
    // A room under another room has no top edge where the upper one stands.
    expect(runs.some((r) => r.floor === 0 && !r.top)).toBe(true);
    expect(Math.max(...runs.map((r) => r.floor))).toBeGreaterThan(0);
  });

  it('never names a room: any layout in the data lays out', () => {
    for (let level = 1; level <= top; level += 1) {
      const runs = wallRuns(roomsAt(HOUSE_DATA, level));
      for (const r of runs) {
        expect(r.to).toBeGreaterThan(r.from);
        for (const hole of [...r.doors, ...r.windows]) {
          expect(hole.u - hole.w / 2).toBeGreaterThanOrEqual(-1e-9);
          expect(hole.u + hole.w / 2).toBeLessThanOrEqual(r.to - r.from + 1e-9);
        }
      }
    }
  });
});

describe('the floor cut (B4)', () => {
  const boxes = (level: number) => roomsAt(HOUSE_DATA, level).map(roomBox);

  it('lists the floors rooms start on: one until the Kitchen goes upstairs, the Hall counting on its first', () => {
    expect(houseFloors(boxes(1))).toEqual([0]);
    expect(houseFloors(boxes(2))).toEqual([0]);
    expect(houseFloors(boxes(3))).toEqual([0, 1]);
    expect(houseFloors(boxes(top))).toEqual([0, 1]);
  });

  it('shows the ground floor with the Kitchen taken away, the Hall whole, and only uncovered rooms’ residents', () => {
    const cut = floorCut(boxes(top), 0);
    expect(cut.floor).toBe(0);
    expect([...cut.shown].sort()).toEqual(['heart-hall', 'playroom', 'snug']);
    expect([...cut.cast].sort()).toEqual(['heart-hall', 'playroom', 'snug']);
    // The Hall's two storeys keep the box as tall as the whole house.
    expect(cut.bounds.maxY).toBe(2 * storey);
    // Level 3: just the ground floor's storey.
    expect(floorCut(boxes(3), 0).bounds.maxY).toBe(storey);
  });

  it('shows upstairs with the ground floor under it, leaving out the residents under the Kitchen', () => {
    const cut = floorCut(boxes(top), 1);
    expect(cut.shown.size).toBe(4);
    // The Snug is under the Kitchen's floor; the Playroom and the Hall are open to the sky.
    expect([...cut.cast].sort()).toEqual(['heart-hall', 'kitchen', 'playroom']);
    expect(cut.bounds).toEqual(houseBounds(boxes(top)));
  });

  it('clamps to the house’s floors', () => {
    expect(floorCut(boxes(1), 3).floor).toBe(0);
    expect(floorCut(boxes(top), 9).floor).toBe(1);
    expect(floorCut(boxes(top), -2).floor).toBe(0);
  });

  it('files a wall by the higher of its rooms, so the Hall’s wall over the Snug goes with the Kitchen', () => {
    const all = boxes(top);
    const runs = wallRuns(roomsAt(HOUSE_DATA, top));
    const stub = runs.find(
      (r) => r.floor === 1 && r.room === 'heart-hall' && r.other === 'kitchen',
    );
    expect(stub).toBeDefined();
    expect(runFloor(stub!, all)).toBe(1);
    const hallBack = runs.find(
      (r) => r.floor === 1 && r.room === 'heart-hall' && r.side === 'north',
    );
    expect(runFloor(hallBack!, all)).toBe(0);
    expect(shownAt(1, 0)).toBe(false);
    expect(shownAt(0, 1)).toBe(true);
  });

  it('marks the walls the cut leaves uncovered, for a cap on their top edge', () => {
    const runs = wallRuns(roomsAt(HOUSE_DATA, top));
    const snugWest = runs.find((r) => r.floor === 0 && r.room === 'snug' && r.side === 'west');
    expect(snugWest).toMatchObject({ top: false, upper: 1 });
    // The Hall's own walls go on up: nothing to cap.
    const hallWest = runs.find(
      (r) => r.floor === 0 && r.room === 'heart-hall' && r.side === 'west',
    );
    expect(hallWest).toMatchObject({ top: false, upper: null });
    expect(runs.filter((r) => r.top).every((r) => r.upper === null)).toBe(true);
  });

  it('knows which room stands over which', () => {
    const [snug, , kitchen, hall] = boxes(top);
    expect(covers(kitchen!, snug!)).toBe(true);
    expect(covers(snug!, kitchen!)).toBe(false);
    expect(covers(kitchen!, hall!)).toBe(false);
  });
});
