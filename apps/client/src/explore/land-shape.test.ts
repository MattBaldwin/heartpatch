import { describe, expect, it } from 'vitest';
import { LAND_LOOKS } from './land-config.js';
import { hexReach, landField, softNoise, unwarp, valueNoise, warp } from './land-shape.js';

const look = LAND_LOOKS['meadow']!;
const SIZE = 7;
const START = { x: 0, z: -2.94 };

describe('the land grid warp', () => {
  it('is odd, monotonic, and undone by unwarp', () => {
    let last = -Infinity;
    for (let t = -1; t <= 1; t += 0.05) {
      const s = warp(t, 3);
      expect(s).toBeGreaterThan(last);
      last = s;
      expect(warp(-t, 3)).toBeCloseTo(-s, 9);
      expect(unwarp(s, 3)).toBeCloseTo(t, 9);
    }
    expect(warp(1, 3)).toBeCloseTo(1, 9);
  });

  it('is finer in the middle than at the rim', () => {
    const middle = unwarp(0.01, 3) - unwarp(0, 3);
    const rim = unwarp(1, 3) - unwarp(0.99, 3);
    expect(rim / middle).toBeGreaterThan(10);
  });
});

describe('hexReach', () => {
  it('is 1 all along the edge: flat sides and corners (at ±z, like clampToTile)', () => {
    expect(hexReach({ x: (SIZE * Math.sqrt(3)) / 2, z: 0 }, SIZE)).toBeCloseTo(1, 9);
    expect(hexReach({ x: 0, z: SIZE }, SIZE)).toBeCloseTo(1, 9);
    expect(hexReach({ x: 0, z: (SIZE * Math.sqrt(3)) / 2 }, SIZE)).toBeLessThan(1);
    expect(hexReach({ x: 0, z: 0 }, SIZE)).toBe(0);
  });
});

describe('noise', () => {
  it('stays in [-1, 1] and is the same for the same seed', () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 0.37 - 50;
      const z = i * 0.61 - 80;
      expect(Math.abs(valueNoise(x, z, 5))).toBeLessThanOrEqual(1);
      expect(Math.abs(softNoise(x, z, 5))).toBeLessThanOrEqual(1);
      expect(valueNoise(x, z, 5)).toBe(valueNoise(x, z, 5));
    }
  });
});

describe('landField', () => {
  const land = landField(look.shape, 1234, SIZE, START);

  it('only rolls gently inside the tile, so feet, taps and spots stay put', () => {
    let lo = Infinity;
    let hi = -Infinity;
    let steepest = 0;
    for (let x = -SIZE; x <= SIZE; x += 0.25) {
      for (let z = -SIZE; z <= SIZE; z += 0.25) {
        if (hexReach({ x, z }, SIZE) > 1) continue;
        const h = land.height(x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        steepest = Math.max(steepest, Math.abs(land.height(x + 0.1, z) - h) / 0.1);
      }
    }
    expect(hi - lo).toBeLessThan(1);
    // Ground taps settle in a few steps on slopes this gentle (ExploreScene.groundAt).
    expect(steepest).toBeLessThan(0.5);
  });

  it('falls away past the edge, so the far trees stand against the sky', () => {
    expect(land.height(0, 20)).toBeLessThan(-3);
    expect(land.height(0, 40)).toBeLessThan(land.height(0, 20));
  });

  it('runs its path beside where the Keeper starts', () => {
    const across = Math.abs(land.pathX(START.z) - START.x);
    expect(across).toBeLessThan(look.shape.path.width);
    expect(land.pathMask(land.pathX(0), 0)).toBe(1);
    expect(land.pathMask(land.pathX(0) + look.shape.path.width, 0)).toBe(0);
  });

  it('is the same land for the same tile and a different one for another', () => {
    const again = landField(look.shape, 1234, SIZE, START);
    const other = landField(look.shape, 99, SIZE, START);
    expect(again.height(2, 3)).toBe(land.height(2, 3));
    expect(other.pathX(5)).not.toBe(land.pathX(5));
  });
});
