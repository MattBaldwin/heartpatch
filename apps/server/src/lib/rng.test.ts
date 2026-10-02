import { SeedSchema } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { newSeed } from './rng.js';

describe('newSeed', () => {
  it('returns a valid, unique 128-bit seed', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => newSeed()));
    expect(seeds.size).toBe(100);
    for (const seed of seeds) {
      expect(SeedSchema.parse(seed)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });
});
