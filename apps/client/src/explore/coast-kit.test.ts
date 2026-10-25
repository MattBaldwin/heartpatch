import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { EXPLORE_RULES } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { BIOME_EXTRAS, buildBiomeSpot, overridesSpot } from './biome-dressing.js';
import { BIOME_LOOKS } from './biome-looks.js';
import { COAST_LOOK, SEA, shoreRadius } from './coast-config.js';
import { COAST_SPOTS } from './coast-kit.js';
import { hexReach, landField } from './land-shape.js';
import { LAND_LIGHT } from './land-config.js';
import { landLayout, type LayoutInput } from './land-layout.js';

const SIZE = 7;
const START = { x: 0, z: -2.94 };
const colliders = [
  { x: 2, z: 1, r: 0.5 },
  { x: -3, z: 2.5, r: 0.5 },
];

const engine = new NullEngine();
afterEach(() => {
  for (const scene of [...engine.scenes]) scene.dispose();
});

function grow(seed = 42) {
  const input: LayoutInput = {
    growth: COAST_LOOK.growth,
    land: landField(COAST_LOOK.shape, seed, SIZE, START),
    seed,
    size: SIZE,
    colliders,
    start: START,
    sun: { x: 0.58, z: -0.76 },
    shadow: LAND_LIGHT.shadow,
    extras: BIOME_EXTRAS['coast']!.place,
  };
  return { layout: landLayout(input), land: input.land };
}

describe('coast look', () => {
  it('is the biome look for the coast terrain', () => {
    expect(BIOME_LOOKS['coast']).toBe(COAST_LOOK);
    expect(Object.keys(BIOME_EXTRAS['coast']!.layers).sort()).toEqual(
      Object.keys(grow().layout.extras).sort(),
    );
  });

  it('keeps every step of the tile dry and puts the waterline just past its edge', () => {
    for (const seed of [1, 42, 977]) {
      const { land } = grow(seed);
      // The whole hex the Keeper walks is sand, well above the sea.
      for (let a = 0; a < 360; a += 15) {
        for (const reach of [0, 0.5, 0.95]) {
          const r = reach * SIZE * 0.95;
          const h = land.height(
            Math.cos((a * Math.PI) / 180) * r,
            Math.sin((a * Math.PI) / 180) * r,
          );
          expect(h, `seed ${String(seed)} ${String(a)}° ${String(reach)}`).toBeGreaterThan(
            SEA.level + 0.3,
          );
        }
      }
      // Past the shoreline the sand is under the sea; just inside it, above.
      const rs = shoreRadius();
      expect(rs).toBeGreaterThan(SIZE);
      expect(hexReach({ x: rs, z: 0 }, SIZE)).toBeGreaterThan(1);
      expect(land.height(rs + 1.5, 0)).toBeLessThan(SEA.level);
      expect(land.height(rs - 0.8, 0)).toBeGreaterThan(SEA.level);
    }
  });
});

describe('coast dressing', () => {
  it('places the same coast every time, and a different one for another tile', () => {
    expect(grow().layout.extras).toEqual(grow().layout.extras);
    expect(grow(7).layout.extras['palms']).not.toEqual(grow().layout.extras['palms']);
  });

  it('puts the sea and foam round the middle and keeps palms and rocks off the camera side', () => {
    const { sea = [], foam = [], palms = [], 'sea-rocks': rocks = [] } = grow().layout.extras;
    expect(sea).toHaveLength(1);
    expect(foam).toHaveLength(1);
    expect(palms.length).toBeGreaterThanOrEqual(3);
    for (const p of [...palms, ...rocks]) {
      expect(p.z < -SIZE * 0.5 && Math.abs(p.x) < SIZE * 1.5).toBe(false);
    }
  });

  it('keeps driftwood and shells off the spots', () => {
    const { 'drift-logs': logs = [], 'shell-bits': shells = [] } = grow().layout.extras;
    expect(shells.length).toBeGreaterThan(10);
    for (const g of [...logs, ...shells]) {
      for (const k of colliders) expect(Math.hypot(g.x - k.x, g.z - k.z)).toBeGreaterThan(k.r);
    }
  });
});

describe('coast spots', () => {
  const coast = EXPLORE_RULES.terrains.find((t) => t.terrain === 'coast');

  it('draws every kind in the coast kit, and no other terrain’s', () => {
    expect(Object.keys(COAST_SPOTS).sort()).toEqual((coast?.kinds ?? []).map((k) => k.kind).sort());
    expect(overridesSpot('coast', 'rock')).toBe(false);
  });

  it('builds a mesh and a glint for each, with the Snorkel’s tide pool and kelp bed among them', () => {
    const scene = new Scene(engine);
    for (const kind of ['shells', 'driftwood', 'crab-hole', 'tide-pool', 'kelp-bed']) {
      const shape = buildBiomeSpot(scene, kind, 'coast');
      expect(shape, kind).not.toBeNull();
      expect(shape?.mesh.getTotalVertices(), kind).toBeGreaterThan(0);
      expect(shape?.glint, kind).toBeGreaterThan(0);
    }
  });

  it('builds the sea, the foam and the palms', () => {
    const scene = new Scene(engine);
    for (const [name, layer] of Object.entries(BIOME_EXTRAS['coast']!.layers)) {
      expect(layer.build(scene).getTotalVertices(), name).toBeGreaterThan(0);
    }
  });
});
