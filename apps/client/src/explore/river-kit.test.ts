import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { EXPLORE_RULES } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { BIOME_EXTRAS, buildBiomeSpot, overridesSpot } from './biome-dressing.js';
import { BIOME_LOOKS } from './biome-looks.js';
import { EXPLORE_VIEW } from './explore-config.js';
import { hexReach, landField } from './land-shape.js';
import { LAND_LIGHT } from './land-config.js';
import { landLayout, type LayoutInput } from './land-layout.js';
import { bankRadius, CROSSINGS, farBankRadius, RIVER, RIVER_LOOK } from './river-config.js';
import { farBankHeight, RIVER_SPOTS } from './river-kit.js';

const SIZE = 7;
const START = { x: 0, z: -2.94 };
const colliders = [
  { x: 2, z: 1, r: 0.5 },
  { x: -3, z: 2.5, r: 0.5 },
  { x: 0.5, z: 5.6, r: 0.5 },
];

const engine = new NullEngine();
afterEach(() => {
  for (const scene of [...engine.scenes]) scene.dispose();
});

function grow(seed = 42) {
  const input: LayoutInput = {
    growth: RIVER_LOOK.growth,
    land: landField(RIVER_LOOK.shape, seed, SIZE, START),
    seed,
    size: SIZE,
    colliders,
    start: START,
    sun: { x: 0.58, z: -0.76 },
    shadow: LAND_LIGHT.shadow,
    extras: BIOME_EXTRAS['river']!.place,
  };
  return { layout: landLayout(input), land: input.land };
}

const bearing = (g: { x: number; z: number }) => (Math.atan2(g.z, g.x) * 180) / Math.PI;

describe('river look', () => {
  it('is the biome look for the river terrain', () => {
    expect(BIOME_LOOKS['river']).toBe(RIVER_LOOK);
    expect(Object.keys(BIOME_EXTRAS['river']!.layers).sort()).toEqual(
      Object.keys(grow().layout.extras).sort(),
    );
  });

  it('keeps the whole walkable bank dry, with the water just past its edge', () => {
    for (const seed of [1, 42, 977]) {
      const { land } = grow(seed);
      for (let a = 0; a < 360; a += 15) {
        for (const reach of [0, 0.5, 0.95]) {
          const r = reach * SIZE * 0.95;
          const h = land.height(
            Math.cos((a * Math.PI) / 180) * r,
            Math.sin((a * Math.PI) / 180) * r,
          );
          expect(h, `seed ${String(seed)} ${String(a)}° ${String(reach)}`).toBeGreaterThan(
            RIVER.level + 0.3,
          );
        }
      }
      // Past the bank's shoreline the ground is under the river (deep: nobody wades it).
      const rs = bankRadius();
      expect(rs).toBeGreaterThan(SIZE);
      expect(hexReach({ x: rs, z: 0 }, SIZE)).toBeGreaterThan(1);
      expect(land.height(rs + 1.5, 0)).toBeLessThan(RIVER.level - 0.5);
      expect(land.height(rs - 0.8, 0)).toBeGreaterThan(RIVER.level);
    }
  });

  it('puts a far bank across the river that climbs out of the water', () => {
    expect(farBankRadius() - bankRadius()).toBe(RIVER.width);
    for (const a of [0, 1, 2, 3]) {
      expect(farBankHeight(-0.5, a)).toBeLessThan(RIVER.level + 0.06);
      expect(farBankHeight(RIVER.farBank.slope, a)).toBeGreaterThan(RIVER.level + 0.3);
    }
  });
});

describe('river dressing', () => {
  it('places the same bank every time, and a different one for another tile', () => {
    expect(grow().layout.extras).toEqual(grow().layout.extras);
    expect(grow(7).layout.extras['bank-reeds']).not.toEqual(grow().layout.extras['bank-reeds']);
  });

  it('draws the river, its ripples, far bank and crossings once round the middle', () => {
    const { extras } = grow().layout;
    for (const name of ['river', 'ripples', 'river-rocks', 'far-bank', 'crossings', 'lantern']) {
      expect(extras[name], name).toEqual([{ x: 0, z: 0, yaw: 0, scale: 1 }]);
    }
  });

  it('keeps reeds and rocks on the rim, off the spots, the camera side and the crossings', () => {
    const { 'bank-reeds': reeds = [], 'bank-rocks': rocks = [] } = grow().layout.extras;
    expect(reeds.length).toBeGreaterThan(5);
    for (const g of [...reeds, ...rocks]) {
      for (const k of colliders) expect(Math.hypot(g.x - k.x, g.z - k.z)).toBeGreaterThan(k.r);
      expect(g.z < -SIZE * 0.5 && Math.abs(g.x) < SIZE * 1.5).toBe(false);
      for (const c of [CROSSINGS.stones, CROSSINGS.log, CROSSINGS.jetty]) {
        expect(Math.abs(bearing(g) - c)).toBeGreaterThan(8);
      }
    }
  });
});

describe('river spots', () => {
  const river = EXPLORE_RULES.terrains.find((t) => t.terrain === 'river');

  it('draws every kind in the river kit, and no other terrain’s', () => {
    expect(Object.keys(RIVER_SPOTS).sort()).toEqual((river?.kinds ?? []).map((k) => k.kind).sort());
    expect(overridesSpot('river', 'rock')).toBe(false);
    for (const kind of Object.keys(RIVER_SPOTS)) {
      expect(EXPLORE_VIEW.spotRadius[kind], kind).toBeGreaterThan(0);
    }
  });

  it('builds a mesh and a glint for each, with the Snorkel’s eddy and cattails among them', () => {
    const scene = new Scene(engine);
    for (const kind of ['mossy-log', 'pebble-bar', 'eddy', 'cattails']) {
      const shape = buildBiomeSpot(scene, kind, 'river');
      expect(shape, kind).not.toBeNull();
      expect(shape?.mesh.getTotalVertices(), kind).toBeGreaterThan(0);
      expect(shape?.glint, kind).toBeGreaterThan(0);
    }
  });

  it('builds the water, the far bank, the crossings and the reeds, inside the mobile budget', () => {
    const scene = new Scene(engine);
    let triangles = 0;
    for (const [name, layer] of Object.entries(BIOME_EXTRAS['river']!.layers)) {
      const mesh = layer.build(scene);
      expect(mesh.getTotalVertices(), name).toBeGreaterThan(0);
      triangles += mesh.getTotalIndices() / 3;
    }
    // Every layer drawn once (the reeds are a handful of instances): keep the
    // river's own geometry well under the iPhone's 480k scene budget.
    expect(triangles).toBeLessThan(120_000);
  });
});
