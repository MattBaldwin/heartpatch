import { describe, expect, it } from 'vitest';
import { farHollowSeed } from './far-hollow.js';

const halloween = { id: 'halloween', year: 2026 };

describe('farHollowSeed (#306 PR 6)', () => {
  it('is fixed for a map and season, and new for the next season or another map', () => {
    const seed = farHollowSeed('map-seed', halloween);
    expect(farHollowSeed('map-seed', halloween)).toBe(seed);
    expect(farHollowSeed('map-seed', { id: 'thanksgiving', year: 2026 })).not.toBe(seed);
    expect(farHollowSeed('map-seed', { id: 'halloween', year: 2027 })).not.toBe(seed);
    expect(farHollowSeed('other-map', halloween)).not.toBe(seed);
  });
});
