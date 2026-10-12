import { HOUSE_DATA, roomsAt } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HOUSE_GRID } from './house-config.js';
import { houseBounds, roomBox, wallRuns } from './house-layout.js';

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
