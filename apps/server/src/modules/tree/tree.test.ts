import { PATCH_TREE } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { orderedPair, ornamentSourceOf, treePostOf } from './service.js';

describe('the Patch Tree rules (#37 2c)', () => {
  it('stands at the post nearest the centre, ties to the lowest (q, r), whatever the order', () => {
    const posts = [
      { id: 'far', q: 6, r: -3 },
      { id: 'tie-b', q: 2, r: 1 },
      { id: 'tie-a', q: -3, r: 0 },
      { id: 'other', q: 0, r: -4 },
    ];
    expect(treePostOf(posts)?.id).toBe('tie-a');
    expect(treePostOf([...posts].reverse())?.id).toBe('tie-a');
    expect(treePostOf([posts[0]!])?.id).toBe('far');
    expect(treePostOf([])).toBeNull();
  });

  it('calls a gift with a present in it a present gift', () => {
    const present = { kind: 'item', itemId: PATCH_TREE.presentItemId, quantity: 1 } as const;
    const timber = { kind: 'item', itemId: 'timber', quantity: 3 } as const;
    expect(ornamentSourceOf([timber])).toBe('gift');
    expect(ornamentSourceOf([timber, present])).toBe('present-gift');
    expect(ornamentSourceOf([])).toBe('gift');
  });

  it('orders a warmth pair by its lowercase ids (the order the DB CHECK uses; the DB tests hit it)', () => {
    const a = '0a1b2c3d-0000-4000-8000-000000000000';
    const b = 'f0000000-0000-4000-8000-000000000000';
    expect(orderedPair(b, a)).toEqual([a, b]);
    expect(orderedPair(a, b)).toEqual([a, b]);
  });
});
