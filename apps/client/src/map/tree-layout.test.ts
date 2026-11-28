import { describe, expect, it } from 'vitest';
import { CAMERA } from '../engine/config.js';
import { CHRISTMAS, HEX_SIZE } from './map-config.js';
import { TILE_RADIUS } from './map-scene.js';
import {
  ornamentLayout,
  radiusAt,
  shownOrnaments,
  treeFits,
  treeSpot,
  TREE_REACH,
  TREE_TOP,
} from './tree-layout.js';
import { STAR_AT } from './tree-model.js';

const T = CHRISTMAS.tree;

describe('the Patch Tree layout (#37 2d)', () => {
  it('hangs no ornaments on a bare tree and stops at the cap', () => {
    expect(ornamentLayout(0)).toEqual([]);
    expect(shownOrnaments(-3)).toBe(0);
    expect(shownOrnaments(Number.NaN)).toBe(0);
    expect(ornamentLayout(6)).toHaveLength(6);
    expect(ornamentLayout(12)).toHaveLength(12);
    expect(ornamentLayout(500)).toHaveLength(T.ornamentCap);
    // The star's count fits on the tree with room to spare.
    expect(T.ornamentCap).toBeGreaterThanOrEqual(STAR_AT);
  });

  it('keeps every ornament where it was as more go up', () => {
    const six = ornamentLayout(6);
    expect(ornamentLayout(12).slice(0, 6)).toEqual(six);
  });

  it('hangs ornaments on the tiers, on the camera side, spread top to bottom', () => {
    const all = ornamentLayout(T.ornamentCap);
    for (const o of all) {
      // On the skin of the tree at its height, within an ornament of it.
      const skin = radiusAt(o.y);
      expect(skin).toBeGreaterThan(0);
      expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(skin + T.ornamentRadius);
      // Never behind the tree from the camera's side (−z).
      expect(o.z).toBeLessThan(skin * 0.7);
      expect(o.y).toBeLessThan(T.star.y - T.star.radius);
    }
    // A few already reach the top and the bottom thirds.
    const six = ornamentLayout(6).map((o) => o.y);
    const span = TREE_TOP - T.tiers[0].y;
    expect(Math.max(...six) - Math.min(...six)).toBeGreaterThan(span * 0.4);
  });

  it('stands left of the hut and towards the camera, inside its tile', () => {
    const at = treeSpot({ q: 0, r: 0 }, HEX_SIZE);
    expect(at.x).toBeLessThan(0);
    expect(at.z).toBeLessThan(0);
    // Its widest part stays on the tile (inside the flat edges).
    expect(Math.hypot(at.x, at.z) + TREE_REACH).toBeLessThan(TILE_RADIUS * Math.cos(Math.PI / 6));
  });

  it('never reaches the top of its tile on screen (the post flag) nor its top-right corner (#37 M0)', () => {
    expect(treeFits(CAMERA.pitch, TILE_RADIUS)).toBe(true);
    // The check bites: on a tile a third the size it wouldn't fit.
    expect(treeFits(CAMERA.pitch, TILE_RADIUS * 0.3)).toBe(false);
  });
});
