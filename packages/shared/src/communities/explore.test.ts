import { describe, expect, it } from 'vitest';
import { exploreJoy, placeEchoes } from './explore.js';

describe('exploreJoy (#306 2a)', () => {
  it('is the share of spots searched, 0–100', () => {
    expect(exploreJoy({ searched: 0, total: 12 })).toBe(0);
    expect(exploreJoy({ searched: 3, total: 12 })).toBe(25);
    expect(exploreJoy({ searched: 12, total: 12 })).toBe(100);
    expect(exploreJoy({ searched: 1, total: 0 })).toBe(0);
  });
});

/** Squared distance (the shared code keeps clear of `Math.hypot`, tech spec §8). */
const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

describe('placeEchoes (#306 2a)', () => {
  const spots = [
    { x: 0, z: 0 },
    { x: 0.3, z: 0.2 },
    { x: -0.3, z: -0.3 },
  ];

  it('is the same for everyone, and differs from tile to tile', () => {
    const a = placeEchoes('village-seed', { q: 2, r: 3 }, spots, 1);
    expect(placeEchoes('village-seed', { q: 2, r: 3 }, spots, 1)).toEqual(a);
    expect(placeEchoes('village-seed', { q: 3, r: 3 }, spots, 1)).not.toEqual(a);
  });

  it('keeps clear of every spot and of the tile edge', () => {
    for (let q = 0; q < 30; q++) {
      const [echo] = placeEchoes('seed', { q, r: -q }, spots, 1);
      expect(echo).toBeDefined();
      expect(d2(echo!, { x: 0, z: 0 })).toBeLessThanOrEqual(0.55 * 0.55);
      for (const s of spots) expect(d2(echo!, s)).toBeGreaterThanOrEqual(0.2 * 0.2);
    }
  });

  it('places as many as asked, apart from each other', () => {
    const [a, b] = placeEchoes('seed', { q: 1, r: 1 }, spots, 2);
    expect(d2(a!, b!)).toBeGreaterThanOrEqual(0.2 * 0.2);
    expect(placeEchoes('seed', { q: 1, r: 1 }, spots, 0)).toEqual([]);
  });
});
