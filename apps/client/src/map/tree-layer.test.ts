import type { MapView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView } from './test-view.js';
import { createTreeLayer } from './tree-layer.js';
import { TREE_TEXT } from './tree-model.js';

const withTree = (view: MapView, ornaments: number, starLit = false, id?: string): MapView => ({
  ...view,
  map: { ...view.map, id: id ?? view.map.id },
  christmas: { presentWaiting: false, tree: { postIndex: 0, ornaments, starLit } },
});

describe('the Patch Tree line (#37 2d)', () => {
  it('says nothing for the first look at a patch, then once per change', () => {
    const said: string[] = [];
    const layer = createTreeLayer({ say: (t) => said.push(t) });
    const view = testView();
    layer.attach(null as never, withTree(view, 5));
    expect(said).toEqual([]);
    layer.update?.(withTree(view, 6));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(TREE_TEXT.ornament);
    // A resync with the same tree says nothing.
    layer.update?.(withTree(view, 6));
    expect(said).toHaveLength(1);
    layer.update?.(withTree(view, 12, true));
    expect(said[1]).toBe(TREE_TEXT.starLit);
  });

  it("says nothing for another patch's tree", () => {
    const said: string[] = [];
    const layer = createTreeLayer({ say: (t) => said.push(t) });
    const view = testView();
    layer.attach(null as never, withTree(view, 2));
    layer.attach(null as never, withTree(view, 9, false, '0190a8c4-0000-7000-8000-0000000000ff'));
    expect(said).toEqual([]);
  });
});
