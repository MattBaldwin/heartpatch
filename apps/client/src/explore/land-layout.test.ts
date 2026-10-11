import { describe, expect, it } from 'vitest';
import { LAND_LIGHT, LAND_LOOKS } from './land-config.js';
import { landLayout, type Growth, type LayoutInput } from './land-layout.js';
import { hexReach, landField } from './land-shape.js';

const look = LAND_LOOKS['meadow']!;
const SIZE = 7;
const START = { x: 0, z: -2.94 };
const colliders = [
  { x: 2, z: 1, r: 0.32 },
  { x: -3, z: 2.5, r: 0.3 },
  { x: 1, z: -4, r: 0.5 },
];

function input(seed = 42): LayoutInput {
  return {
    growth: look.growth,
    land: landField(look.shape, seed, SIZE, START),
    seed,
    size: SIZE,
    colliders,
    start: START,
    sun: { x: 0.58, z: -0.76 },
    shadow: LAND_LIGHT.shadow,
  };
}

describe('landLayout', () => {
  const layout = landLayout(input());
  const blocking: Growth[] = [
    ...layout.bushes,
    ...layout.berryBushes,
    ...layout.trees.oak,
    ...layout.trees.birch,
    ...layout.trees.pine,
    ...layout.farTrees,
    ...layout.rocks,
    ...layout.logs,
    ...layout.lamps,
  ];

  it('grows nothing you would bump into inside the tile', () => {
    for (const g of blocking) expect(hexReach(g, SIZE)).toBeGreaterThanOrEqual(1);
  });

  it('keeps grass and flowers off the spots', () => {
    const flowers = [...layout.flowers.daisy, ...layout.flowers.tulip, ...layout.flowers.bell];
    for (const g of [...layout.tufts, ...flowers]) {
      for (const c of colliders) expect(Math.hypot(g.x - c.x, g.z - c.z)).toBeGreaterThan(c.r);
    }
  });

  it('never puts a tree between the camera and the tile', () => {
    const trees = [...layout.trees.oak, ...layout.trees.birch, ...layout.trees.pine];
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) expect(t.z < -SIZE * 0.55 && Math.abs(t.x) < 9).toBe(false);
  });

  it('is dense where it matters: grass, flowers, a hedge and trees all round', () => {
    expect(layout.tufts.length).toBeGreaterThan(1500);
    expect(layout.flowers.daisy.length + layout.flowers.bell.length).toBeGreaterThan(100);
    expect(layout.bushes.length + layout.berryBushes.length).toBeGreaterThan(30);
    expect(layout.farTrees.length).toBe(look.growth.trees.far);
    expect(layout.butterflies.length).toBe(look.growth.butterflies);
  });

  it('casts each shadow along the sun, away from what casts it', () => {
    const cast = layout.shades.filter((s) => s.along);
    expect(cast.length).toBeGreaterThan(0);
    for (const s of cast) expect(s.along?.x).toBeCloseTo(0.58 / Math.hypot(0.58, 0.76), 6);
  });

  it('grows the same meadow on every device', () => {
    expect(landLayout(input())).toEqual(layout);
    expect(landLayout(input(7)).tufts[0]).not.toEqual(layout.tufts[0]);
  });
});
