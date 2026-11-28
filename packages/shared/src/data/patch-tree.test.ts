import { describe, expect, it } from 'vitest';
import { isTradableResource } from '../schemas/data/resources.js';
import { GAME_DATA } from './index.js';
import { PATCH_TREE } from './patch-tree.js';

describe('PATCH_TREE (#37 2c)', () => {
  it('lights the star after some gifts, and a present gift counts more', () => {
    expect(Number.isInteger(PATCH_TREE.starAt)).toBe(true);
    expect(PATCH_TREE.starAt).toBeGreaterThan(1);
    for (const table of [PATCH_TREE.ornaments, PATCH_TREE.warmth]) {
      for (const n of Object.values(table)) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
      }
      expect(table['present-gift']).toBeGreaterThan(table.gift);
    }
  });

  it('names a real, tradable present item', () => {
    const present = GAME_DATA.resources.find((r) => r.id === PATCH_TREE.presentItemId);
    expect(present).toBeDefined();
    expect(isTradableResource(present!)).toBe(true);
  });
});
