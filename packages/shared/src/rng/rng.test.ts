import { describe, expect, it } from 'vitest';
import { Rng, type RngState } from './index.js';

const rolls = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.nextUint32());

describe('Rng', () => {
  it('gives the same rolls for the same seed', () => {
    expect(rolls(Rng.fromSeed('pumpkin'), 50)).toEqual(rolls(Rng.fromSeed('pumpkin'), 50));
  });

  it('gives different rolls for nearby seeds', () => {
    expect(rolls(Rng.fromSeed('seed-1'), 5)).not.toEqual(rolls(Rng.fromSeed('seed-2'), 5));
  });

  it('is pinned to known values, so a change to the algorithm breaks stored replays loudly', () => {
    const rng = Rng.fromSeed('heartpatch');
    expect(rolls(rng, 3)).toEqual([865179328, 4112687283, 1824365519]);
    expect(rng.state()).toEqual([3162998136, 3496952200, 1440543407, 3545998826]);
  });

  it('resumes exactly from a saved state, and never changes the saved state', () => {
    const rng = Rng.fromSeed('acorn');
    rolls(rng, 7);
    const saved: RngState = Object.freeze(rng.state());
    const ahead = rolls(rng, 20);
    const resumed = Rng.fromState(saved);
    expect(rolls(resumed, 20)).toEqual(ahead);
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });

  it('saves state as four unsigned 32-bit integers', () => {
    const rng = Rng.fromSeed('heartpatch');
    for (let i = 0; i < 100; i++) {
      rng.nextUint32();
      for (const word of rng.state()) {
        expect(Number.isInteger(word) && word >= 0 && word <= 0xffff_ffff).toBe(true);
      }
    }
  });

  it('rejects empty seeds and bad states', () => {
    expect(() => Rng.fromSeed('')).toThrow();
    expect(() => Rng.fromState([1, 2, 3] as unknown as RngState)).toThrow();
    expect(() => Rng.fromState([1, 2, 3, -1])).toThrow();
    expect(() => Rng.fromState([1, 2, 3, 0.5])).toThrow();
  });

  it('next() stays in [0, 1)', () => {
    const rng = Rng.fromSeed('floats');
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  it('int() covers [min, max] inclusive and nothing else', () => {
    const rng = Rng.fromSeed('dice');
    const seen = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const n = rng.int(1, 6);
      seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const count of seen.values()) expect(count).toBeGreaterThan(800);
    expect(rng.int(4, 4)).toBe(4);
    expect(rng.int(-3, -3)).toBe(-3);
  });

  it('int() rejects bad ranges', () => {
    const rng = Rng.fromSeed('dice');
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    expect(() => rng.int(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('chance() never fires at 0 and always fires at 100', () => {
    const rng = Rng.fromSeed('coin');
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(100)).toBe(true);
      if (rng.chance(25)) hits++;
    }
    expect(hits).toBeGreaterThan(400);
    expect(hits).toBeLessThan(600);
  });

  it('pick() picks every item and rejects an empty list', () => {
    const rng = Rng.fromSeed('pick');
    const seen = new Set(Array.from({ length: 200 }, () => rng.pick(['a', 'b', 'c'])));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('weighted() follows the weights and never picks a zero weight', () => {
    const rng = Rng.fromSeed('weights');
    const items = [
      { id: 'never', weight: 0 },
      { id: 'rare', weight: 1 },
      { id: 'common', weight: 9 },
    ];
    const counts = { never: 0, rare: 0, common: 0 };
    for (let i = 0; i < 10_000; i++) counts[rng.weighted(items).id as keyof typeof counts]++;
    expect(counts.never).toBe(0);
    expect(counts.rare).toBeGreaterThan(800);
    expect(counts.rare).toBeLessThan(1200);
  });

  it('weighted() rejects bad weights', () => {
    const rng = Rng.fromSeed('weights');
    expect(() => rng.weighted([])).toThrow(RangeError);
    expect(() => rng.weighted([{ weight: 0 }])).toThrow(RangeError);
    expect(() => rng.weighted([{ weight: -1 }, { weight: 2 }])).toThrow(RangeError);
    expect(() => rng.weighted([{ weight: Number.NaN }])).toThrow(RangeError);
    expect(() => rng.weighted([{ weight: Number.POSITIVE_INFINITY }])).toThrow(RangeError);
  });

  it('weighted() handles tiny weights next to big ones', () => {
    const rng = Rng.fromSeed('tiny');
    const items = [{ weight: 1e-12 }, { weight: 1 }, { weight: 0 }];
    for (let i = 0; i < 1000; i++) expect(items).toContain(rng.weighted(items));
  });
});
