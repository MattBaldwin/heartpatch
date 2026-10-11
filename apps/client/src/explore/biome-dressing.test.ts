import { describe, expect, it } from 'vitest';
import { BIOME_EXTRAS, overridesSpot } from './biome-dressing.js';
import { BIOME_LOOKS } from './biome-looks.js';
import { LAND_LIGHT } from './land-config.js';
import { landLayout, type LayoutInput } from './land-layout.js';
import { landField } from './land-shape.js';

const SIZE = 7;
const START = { x: 0, z: -2.94 };
const colliders = [
  { x: 2, z: 1, r: 0.32 },
  { x: -3, z: 2.5, r: 0.3 },
];

function grow(terrain: 'mountains' | 'hills', seed = 42) {
  const look = BIOME_LOOKS[terrain]!;
  const input: LayoutInput = {
    growth: look.growth,
    land: landField(look.shape, seed, SIZE, START),
    seed,
    size: SIZE,
    colliders,
    start: START,
    sun: { x: 0.58, z: -0.76 },
    shadow: LAND_LIGHT.shadow,
    extras: BIOME_EXTRAS[terrain]!.place,
  };
  return { layout: landLayout(input), land: input.land };
}

describe('biome dressing', () => {
  it('places the same trail and cave every time', () => {
    expect(grow('mountains').layout.extras).toEqual(grow('mountains').layout.extras);
    expect(grow('hills').layout.extras).toEqual(grow('hills').layout.extras);
    expect(grow('hills', 7).layout.extras).not.toEqual(grow('hills').layout.extras);
  });

  it('gives every layer it places a builder', () => {
    for (const terrain of ['mountains', 'hills'] as const) {
      const placed = Object.keys(grow(terrain).layout.extras);
      expect(placed.sort()).toEqual(Object.keys(BIOME_EXTRAS[terrain]!.layers).sort());
    }
  });

  it('stands the peaks far off, behind the tile', () => {
    const { peaks = [] } = grow('mountains').layout.extras;
    expect(peaks.length).toBeGreaterThanOrEqual(10);
    for (const p of peaks) {
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(SIZE * 3.5);
      expect(p.z).toBeGreaterThan(0);
    }
  });

  it('walls the cave in without standing between the camera and the tile', () => {
    const { 'wall-rocks': walls = [] } = grow('hills').layout.extras;
    expect(walls.length).toBe(30);
    for (const w of walls) {
      expect(Math.hypot(w.x, w.z)).toBeGreaterThan(SIZE * 1.3);
      expect(w.z < -SIZE * 0.5 && Math.abs(w.x) < SIZE * 1.5).toBe(false);
    }
  });

  it('keeps crystals off the spots and lights a pool under each crystal and cap', () => {
    const { layout } = grow('hills');
    const { crystals = [], 'glow-caps': caps = [] } = layout.extras;
    for (const c of crystals) {
      for (const k of colliders)
        expect(Math.hypot(c.x - k.x, c.z - k.z)).toBeGreaterThan(k.r + 0.3);
    }
    const pools = layout.shades.filter((s) => s.tint);
    expect(pools).toHaveLength(crystals.length + caps.length);
    expect(grow('mountains').layout.shades.some((s) => s.tint)).toBe(false);
  });

  it('raises the cave floor into its walls, and drops the trail away to the peaks', () => {
    const cave = grow('hills').land;
    const trail = grow('mountains').land;
    expect(cave.height(0, SIZE * 1.8)).toBeGreaterThan(cave.height(0, 0) + 2);
    expect(trail.height(0, SIZE * 2)).toBeLessThan(trail.height(0, 0) - 2);
  });
});

describe('biome spots', () => {
  it('gives the cave its own bare-stone rock, and leaves every other spot to the meadow kit', () => {
    expect(overridesSpot('hills', 'rock')).toBe(true);
    expect(overridesSpot('meadow', 'rock')).toBe(false);
    expect(overridesSpot('mountains', 'rock')).toBe(false);
    expect(overridesSpot('hills', 'tree')).toBe(false);
  });
});
