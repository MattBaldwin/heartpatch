import { hexDistance, hexKey, hexNeighbors } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView } from '../map/test-view.js';
import { hexCorners, mapWindow, oldLand, planTreasureMap } from './treasure-map.js';

describe('the treasure map (#306, owner decision 2026-10-22)', () => {
  const view = testView(2);
  const key = view.tiles.find((t) => t.communityId === null && t.homeSlot === null)!;
  const square = view.communities![0]!.square;
  const marks = { key, start: square };

  it('draws the land as it was: cleared land and posts are old meadow', () => {
    expect(oldLand('forest')).toBe('forest');
    expect(oldLand('pumpkin-fields')).toBe('pumpkins');
    expect(oldLand('junipers-gap')).toBe('gap');
    for (const later of ['clearing', 'trading-post', 'some-new-terrain']) {
      expect(oldLand(later)).toBe('meadow');
    }
  });

  it('shows the land round the Hollow and the key, both well inside', () => {
    const window = mapWindow(view.tiles, marks)!;
    for (const mark of [key, square]) {
      expect(hexDistance(mark, window.centre)).toBeLessThanOrEqual(window.reach - 3);
    }
    expect(window.tiles.every((t) => hexDistance(t, window.centre) <= window.reach)).toBe(true);
    expect(window.tiles.length).toBeLessThan(view.tiles.length);
    // A key off the patch (never sent, but even so): the whole patch, and no ✕.
    expect(mapWindow(view.tiles, { key: { q: 999, r: 999 }, start: square })).toBeNull();
    const off = planTreasureMap(
      view.tiles,
      { key: { q: 999, r: 999 }, start: null },
      { maxWidth: 300, maxHeight: 300 },
    );
    expect(off.hexes).toHaveLength(view.tiles.length);
    expect(off.key).toBeNull();
  });

  it('fits its land inside the room it has, keeping its shape', () => {
    const shown = mapWindow(view.tiles, marks)!.tiles;
    for (const box of [
      { maxWidth: 288, maxHeight: 220 },
      { maxWidth: 342, maxHeight: 360 },
      { maxWidth: 424, maxHeight: 500 },
    ]) {
      const plan = planTreasureMap(view.tiles, marks, box);
      expect(plan.width).toBeLessThanOrEqual(box.maxWidth + 1);
      expect(plan.height).toBeLessThanOrEqual(box.maxHeight + 1);
      expect(plan.hexes).toHaveLength(shown.length);
      // Every tile's corners stay on the paper.
      for (const h of plan.hexes) {
        for (const c of hexCorners(h.x, h.y, plan.radius)) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(plan.width);
          expect(c.y).toBeLessThanOrEqual(plan.height);
        }
      }
    }
  });

  it("marks the key's tile and the Hollow's square where the map draws them", () => {
    const plan = planTreasureMap(view.tiles, marks, { maxWidth: 300, maxHeight: 300 });
    const shown = mapWindow(view.tiles, marks)!.tiles;
    const at = (h: { q: number; r: number }) => {
      const i = shown.findIndex((t) => t.q === h.q && t.r === h.r);
      return { x: plan.hexes[i]!.x, y: plan.hexes[i]!.y };
    };
    expect(plan.key).toEqual(at(key));
    expect(plan.start).toEqual(at(square));
  });

  it('draws north up, the shore only where the patch ends, and fades the rim', () => {
    const plan = planTreasureMap(view.tiles, marks, { maxWidth: 300, maxHeight: 300 });
    const window = mapWindow(view.tiles, marks)!;
    const land = new Set(view.tiles.map(hexKey));
    window.tiles.forEach((t, i) => {
      const open = hexNeighbors(t).filter((n) => !land.has(hexKey(n))).length;
      expect(plan.hexes[i]!.coast).toHaveLength(open);
      expect(plan.hexes[i]!.rim).toBe(hexDistance(t, window.centre) === window.reach);
    });
    expect(plan.hexes.some((h) => h.rim)).toBe(true);
    // r grows southward (world -z, `hexToWorld`), so down the page, as on the map view.
    const rs = window.tiles.map((t) => t.r);
    const north = window.tiles.findIndex((t) => t.r === Math.min(...rs));
    const south = window.tiles.findIndex((t) => t.r === Math.max(...rs));
    expect(plan.hexes[north]!.y).toBeLessThan(plan.hexes[south]!.y);
  });

  it('is the same map every time', () => {
    const box = { maxWidth: 320, maxHeight: 260 };
    expect(planTreasureMap(view.tiles, marks, box)).toEqual(
      planTreasureMap(view.tiles, marks, box),
    );
  });
});
