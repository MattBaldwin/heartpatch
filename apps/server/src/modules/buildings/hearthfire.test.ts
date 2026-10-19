import { hexKey } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { litSafeTiles } from './hearthfire.js';

describe('litSafeTiles', () => {
  it("adds a won village's light, every night with no fuel (#306 PR 3b)", () => {
    const local = { date: '2026-10-02', minute: 0 };
    const home = [{ q: 0, r: 0 }];
    expect(litSafeTiles([], home, local)).toEqual(new Set([hexKey({ q: 0, r: 0 })]));
    const lit = litSafeTiles([], home, local, [{ at: { q: 6, r: 0 }, radius: 2 }]);
    expect(lit.size).toBe(1 + 19);
    expect(lit.has(hexKey({ q: 8, r: 0 }))).toBe(true);
    expect(lit.has(hexKey({ q: 9, r: 0 }))).toBe(false);
  });
});
