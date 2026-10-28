import { describe, expect, it } from 'vitest';
import { bankTop } from './weather-clouds.js';
import { WEATHER_LOOK } from './weather-config.js';
import { boltRoomPoints, seenThroughBank } from './storm-marks.js';

const MARKS = WEATHER_LOOK.marks;

/** A matrix as the layout's `put` writes it: one scale, a translation, and optionally a lean. */
function matrix(x: number, y: number, z: number, scale: number, lean = 0): Float32Array {
  const m = new Float32Array(16);
  m[0] = scale;
  m[5] = scale;
  m[6] = lean;
  m[10] = scale;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  m[15] = 1;
  return m;
}

describe('boltRoomPoints', () => {
  it('runs from part way down the bolt to its foot, and round the foot', () => {
    // A bolt 1.6 long hanging from (2, 1.8, 3), its foot leaning 1.28 towards the camera.
    const points = boltRoomPoints(matrix(2, 1.8, 3, 1.6, 1.28), 0);
    const [upper, foot] = points;
    expect(foot?.x).toBeCloseTo(2);
    expect(foot?.y).toBeCloseTo(0.2);
    expect(foot?.z).toBeCloseTo(3 - 1.28);
    expect(upper?.y).toBeCloseTo(1.8 - 1.6 * MARKS.from);
    const r = Math.hypot(1.6, 1.28) * MARKS.pool;
    const xs = points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(r * 2);
  });

  it('reads the bolt it is asked for', () => {
    const two = new Float32Array(32);
    two.set(matrix(0, 1.8, 0, 1.6));
    two.set(matrix(5, 1.8, 0, 1.6), 16);
    expect(boltRoomPoints(two, 1)[1]?.x).toBeCloseTo(5);
  });
});

describe('seenThroughBank', () => {
  const banks = matrix(4, WEATHER_LOOK.clouds.bank.belly, 2, 1);
  const top = bankTop();

  it('is true looking down through the middle of a bank', () => {
    expect(seenThroughBank({ x: 4, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }, banks, 1, top)).toBe(true);
  });

  it('is true on a slanting look that crosses the bank on its way down', () => {
    // From high and south, looking north-down at a tile behind the bank's middle.
    const eye = { x: 4, y: 8, z: -6 };
    const tile = { x: 4, y: 0, z: 4 };
    const dir = { x: tile.x - eye.x, y: tile.y - eye.y, z: tile.z - eye.z };
    expect(seenThroughBank(eye, dir, banks, 1, top)).toBe(true);
  });

  it('is false past the bank, looking up, or with no banks', () => {
    expect(seenThroughBank({ x: 12, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }, banks, 1, top)).toBe(
      false,
    );
    expect(seenThroughBank({ x: 4, y: 0, z: 2 }, { x: 0, y: 1, z: 0 }, banks, 1, top)).toBe(false);
    expect(seenThroughBank({ x: 4, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }, banks, 0, top)).toBe(
      false,
    );
  });

  it('follows the bank’s scale', () => {
    const small = matrix(4, WEATHER_LOOK.clouds.bank.belly, 2, 0.4);
    // 2 units off the middle: inside a full-size bank (3.2 half-wide), past a small one.
    const eye = { x: 6, y: 10, z: 2 };
    const down = { x: 0, y: -1, z: 0 };
    expect(seenThroughBank(eye, down, banks, 1, top)).toBe(true);
    expect(seenThroughBank(eye, down, small, 1, top)).toBe(false);
  });
});
