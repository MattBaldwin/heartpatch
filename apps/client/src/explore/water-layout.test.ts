import { describe, expect, it } from 'vitest';
import { LAKE_LOOKS, WATER_LOOKS_BY_TERRAIN, WATER_MOTION } from './lake-config.js';
import { landField, hexReach } from './land-shape.js';
import { waterLayout, type WaterLayoutInput } from './water-layout.js';

const land = LAKE_LOOKS['lake']!;
const look = WATER_LOOKS_BY_TERRAIN['lake']!;
const SIZE = 7;
const START = { x: 0, z: -2.94 };
const springs = [
  { x: 2, z: 1 },
  { x: -3, z: 2.5 },
];

function input(seed = 42): WaterLayoutInput {
  return {
    look,
    land: landField(land.shape, seed, SIZE, START),
    seed,
    size: SIZE,
    start: START,
    springs,
    fishColors: 4,
  };
}

describe('waterLayout', () => {
  const layout = waterLayout(input());

  it('grows nothing you would bump into inside the tile', () => {
    for (const g of [...layout.kelp, ...layout.coral]) {
      expect(hexReach(g, SIZE)).toBeGreaterThanOrEqual(1);
    }
  });

  it('never puts kelp between the camera and the tile', () => {
    expect(layout.kelp.length).toBeGreaterThan(look.kelp.near);
    for (const k of layout.kelp) expect(k.z < -SIZE * 0.55 && Math.abs(k.x) < 9).toBe(false);
  });

  it('lines the tile with coral and fills the water with fish and bubbles', () => {
    expect(layout.coral.length).toBeGreaterThan(look.coral.edge);
    expect(layout.fish).toHaveLength(look.fish);
    expect(layout.bubbles).toHaveLength(look.bubbles.ambient + look.bubbles.perSpring * 2);
  });

  it('keeps fish over the tile, clear of where the Keeper starts, and in bounds of the colours', () => {
    for (const f of layout.fish) {
      expect(hexReach(f, SIZE)).toBeLessThanOrEqual(0.95);
      expect(Math.hypot(f.x - START.x, f.z - START.z)).toBeGreaterThanOrEqual(2);
      expect(f.color).toBeGreaterThanOrEqual(0);
      expect(f.color).toBeLessThan(4);
      expect(f.radius).toBeGreaterThanOrEqual(WATER_MOTION.fish.radius[0]);
    }
  });

  it('starts a stream of bubbles at each spring', () => {
    for (const s of springs) {
      const near = layout.bubbles.filter((b) => Math.hypot(b.x - s.x, b.z - s.z) < 0.2);
      expect(near.length).toBeGreaterThanOrEqual(look.bubbles.perSpring);
    }
    for (const b of layout.bubbles) expect(b.rise).toBeGreaterThan(0);
  });

  it('grows the same water on every device', () => {
    expect(waterLayout(input())).toEqual(layout);
    expect(waterLayout(input(7)).kelp[0]).not.toEqual(layout.kelp[0]);
  });
});

describe('the lake look', () => {
  it('grows no flowers, trees or lamps on the bed, and a lot of seagrass', () => {
    const g = land.growth;
    expect(g.flowers).toEqual({ inside: 0, outside: 0 });
    expect(g.trees).toEqual({ near: 0, far: 0 });
    expect(g.lamps + g.butterflies + g.mushrooms).toBe(0);
    expect(g.tufts.inside).toBeGreaterThan(0);
  });

  it('keeps the kit shape: the same edge and fall as the meadow, so the far bed sinks into the haze', () => {
    expect(land.shape.edge).toBe(7);
    expect(land.shape.fall.depth).toBe(16);
  });
});
