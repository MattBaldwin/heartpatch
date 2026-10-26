import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Scene } from '@babylonjs/core/scene';
import { EXPLORE_RULES, searchSpots } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { BIOME_EXTRAS, buildBiomeSpot, overridesSpot } from './biome-dressing.js';
import { BIOME_LOOKS } from './biome-looks.js';
import { EXPLORE_VIEW } from './explore-config.js';
import { insideTile } from './explore-view.js';
import { bankReach, hexReach, landField, type LandSpot } from './land-shape.js';
import { LAND_LIGHT } from './land-config.js';
import { landLayout, type LayoutInput } from './land-layout.js';
import { BANK, bankRadius, farBankRadius, REED_CLEAR, RIVER, RIVER_LOOK } from './river-config.js';
import { buildMist, farBankHeight, RIVER_SPOTS } from './river-kit.js';

const SIZE = 7;
const START = { x: 0, z: -2.94 };
const SPOTS: LandSpot[] = [
  { x: 2, z: 1, kind: 'mossy-log' },
  { x: -3, z: 2.5, kind: 'pebble-bar' },
  { x: 0.5, z: 5.6, kind: 'eddy' },
  { x: 3.2, z: 3.9, kind: 'cattails' },
];
const colliders = SPOTS.map((s) => ({ x: s.x, z: s.z, r: 0.5 }));
/** Tile-local points (size 1) over the hex, every 0.04. */
const grid = Array.from({ length: 51 * 51 }, (_, i) => ({
  x: -1 + (i % 51) * 0.04,
  z: -1 + Math.floor(i / 51) * 0.04,
}));
const walkable = grid.filter((p) => insideTile(p));
const world = (p: { x: number; z: number }) => ({ x: p.x * SIZE, z: p.z * SIZE });

const engine = new NullEngine();
afterEach(() => {
  for (const scene of [...engine.scenes]) scene.dispose();
});

function grow(seed = 42) {
  const input: LayoutInput = {
    growth: RIVER_LOOK.growth,
    land: landField(RIVER_LOOK.shape, seed, SIZE, START, SPOTS),
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

describe('river look', () => {
  it('is the biome look for the river terrain', () => {
    expect(BIOME_LOOKS['river']).toBe(RIVER_LOOK);
    expect(Object.keys(BIOME_EXTRAS['river']!.layers).sort()).toEqual(
      Object.keys(grow().layout.extras).sort(),
    );
  });

  it('runs the meadow down a shore into ankle-deep shallows, never deep where the Keeper can go', () => {
    for (const seed of [1, 42, 977]) {
      const land = landField(RIVER_LOOK.shape, seed, SIZE, START);
      for (const p of walkable) {
        const { x, z } = world(p);
        const e = bankReach({ x, z }, SIZE);
        const under = RIVER.level - land.height(x, z);
        const at = `seed ${String(seed)} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;
        // Never deeper than the shallows anywhere inside the clamp.
        expect(under, at).toBeLessThanOrEqual(BANK.floor + 1e-9);
        // The meadow and the shore are dry; past the bed it's the shallows' floor.
        if (e < BANK.shore) expect(under, at).toBeLessThan(-0.04);
        if (e >= BANK.bed) expect(under, at).toBeCloseTo(BANK.floor, 6);
      }
      // The clamp stops short of the drop: the deep is never walked into.
      expect(Math.max(...walkable.map((p) => bankReach(world(p), SIZE)))).toBeLessThan(BANK.drop);
      // Past the drop, the deep channel (and the meadow's middle is at 0, where the layers sit).
      expect(land.height(0, SIZE * BANK.deep)).toBeLessThan(RIVER.level - 2);
      expect(land.height(0, 0)).toBeCloseTo(0, 9);
    }
    const rs = bankRadius();
    expect(hexReach({ x: 0, z: rs }, SIZE)).toBeGreaterThan(1);
  });

  it('never lets the meadow dip to the water, on any tile', () => {
    // A rise near the middle (where the meadow is levelled to 0) used to sink
    // the rest of the meadow under the water's surface, so it showed through.
    for (let seed = 1; seed <= 120; seed++) {
      const land = landField(RIVER_LOOK.shape, seed * 7919, SIZE, START);
      for (const p of walkable) {
        const { x, z } = world(p);
        if (bankReach({ x, z }, SIZE) >= BANK.shore) continue;
        if (Math.hypot(x, z) > RIVER_LOOK.shape.edge - 0.2) continue;
        expect(land.height(x, z) - RIVER.level, `seed ${String(seed)}`).toBeGreaterThanOrEqual(
          BANK.dry - 1e-9,
        );
      }
    }
  });

  it('keeps the meadow grass, not shore, however low it rolls, on any tile', () => {
    // Shore by height alone painted the meadow's dips sandy and bare.
    for (let seed = 1; seed <= 120; seed++) {
      const land = landField(RIVER_LOOK.shape, seed * 7919, SIZE, START);
      for (const p of walkable) {
        const { x, z } = world(p);
        if (bankReach({ x, z }, SIZE) >= BANK.shore - 0.15) continue;
        expect(land.bank!.shore(x, z), `seed ${String(seed)}`).toBe(0);
      }
    }
  });

  it('pads each spot on the bank to its kind and leaves one on the meadow alone', () => {
    const bare = landField(RIVER_LOOK.shape, 42, SIZE, START);
    const land = landField(RIVER_LOOK.shape, 42, SIZE, START, SPOTS);
    for (const s of SPOTS) {
      const e = bankReach(s, SIZE);
      if (e >= BANK.water) {
        expect(land.height(s.x, s.z), s.kind).toBeCloseTo(
          RIVER.level + (BANK.pads[s.kind] ?? 0),
          6,
        );
      } else if (e < BANK.shore - 0.05) {
        expect(land.height(s.x, s.z), s.kind).toBe(bare.height(s.x, s.z));
      }
    }
    // The fixture has both: a log out on the meadow, an eddy in the shallows.
    expect(bankReach(SPOTS[0]!, SIZE)).toBeLessThan(BANK.shore - 0.05);
    expect(bankReach(SPOTS[2]!, SIZE)).toBeGreaterThan(BANK.water);
  });

  it('builds a short jetty from the waterline, clear of the spots, that the Keeper stands on', () => {
    const land = landField(RIVER_LOOK.shape, 42, SIZE, START, SPOTS);
    const jetty = land.bank?.jetty;
    expect(jetty).toBeTruthy();
    if (!jetty) return;
    const along = (t: number) => ({
      x: jetty.x + Math.cos(jetty.angle) * t,
      z: jetty.z + Math.sin(jetty.angle) * t,
    });
    expect(bankReach(jetty, SIZE)).toBeCloseTo(BANK.water, 6);
    // Its end stays inside the clamp, out over the shallows.
    const end = along(jetty.length - 0.05);
    expect(insideTile({ x: end.x / SIZE, z: end.z / SIZE })).toBe(true);
    expect(bankReach(end, SIZE)).toBeGreaterThan(BANK.bed);
    expect(land.stand(end.x, end.z)).toBeCloseTo(RIVER.level + BANK.jetty.deck, 9);
    // Beside it, the Keeper wades.
    const side = { x: end.x - Math.sin(jetty.angle) * 1.2, z: end.z + Math.cos(jetty.angle) * 1.2 };
    expect(land.stand(side.x, side.z)).toBe(land.height(side.x, side.z));
    for (const s of SPOTS) {
      for (let t = 0; t <= jetty.length; t += 0.1) {
        const p = along(t);
        expect(Math.hypot(p.x - s.x, p.z - s.z), s.kind).toBeGreaterThanOrEqual(BANK.jetty.clear);
      }
    }
  });

  it('puts a far bank across the river that climbs out of the water', () => {
    expect(farBankRadius() - bankRadius()).toBeCloseTo(RIVER.width, 9);
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

  it('draws the river, its ripples, far bank and mist once round the middle, the jetty at the land’s', () => {
    const { layout, land } = grow();
    for (const name of ['river', 'ripples', 'river-rocks', 'far-bank', 'mist']) {
      expect(layout.extras[name], name).toEqual([{ x: 0, z: 0, yaw: 0, scale: 1 }]);
    }
    const jetty = land.bank?.jetty;
    for (const name of ['jetty', 'lantern', 'lantern-halo']) {
      expect(layout.extras[name], name).toEqual([
        { x: jetty?.x, z: jetty?.z, yaw: Math.PI / 2 - (jetty?.angle ?? 0), scale: 1 },
      ]);
    }
  });

  it('grows reeds in the shallows and rocks on the shore, off the spots and the jetty, inside the tile', () => {
    for (const seed of [1, 42, 977]) {
      const { layout, land } = grow(seed);
      const { 'bank-reeds': reeds = [], 'bank-rocks': rocks = [] } = layout.extras;
      expect(reeds.length).toBeGreaterThan(5);
      expect(rocks.length).toBeGreaterThan(1);
      const jetty = land.bank?.jetty;
      for (const [list, from, to] of [
        [reeds, BANK.water, BANK.water + 0.2],
        [rocks, BANK.shore, BANK.water],
      ] as const) {
        for (const g of list) {
          const e = bankReach(g, SIZE);
          expect(e).toBeGreaterThan(from);
          expect(e).toBeLessThan(to);
          expect(insideTile({ x: g.x / SIZE, z: g.z / SIZE }, 0)).toBe(true);
          for (const k of colliders) expect(Math.hypot(g.x - k.x, g.z - k.z)).toBeGreaterThan(k.r);
          // Reeds stand well off each spot, and off the strip from it towards
          // the camera (-z), where the Keeper stands to search: none hides it.
          if (list === reeds) {
            for (const k of colliders) {
              for (let back = 0; back <= REED_CLEAR.front; back += 0.05) {
                expect(Math.hypot(g.x - k.x, g.z - (k.z - back))).toBeGreaterThanOrEqual(
                  k.r + REED_CLEAR.gap - 1e-9,
                );
              }
            }
          }
          if (jetty) {
            const t = Math.min(
              jetty.length,
              Math.max(
                0,
                (g.x - jetty.x) * Math.cos(jetty.angle) + (g.z - jetty.z) * Math.sin(jetty.angle),
              ),
            );
            const px = jetty.x + Math.cos(jetty.angle) * t;
            const pz = jetty.z + Math.sin(jetty.angle) * t;
            expect(Math.hypot(g.x - px, g.z - pz)).toBeGreaterThan(BANK.jetty.width / 2);
          }
        }
      }
    }
  });

  it('grows no grass or flowers on the shore or in the water', () => {
    const { layout, land } = grow();
    for (const g of [...layout.tufts, ...layout.flowers.daisy, ...layout.flowers.bell]) {
      expect(land.bank?.shore(g.x, g.z) ?? 0).toBeLessThanOrEqual(0.35);
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

  it('lays the mist only out past the drop, off every spot, each wisp fading to nothing at its rim', () => {
    // Over the shallows a wisp lay on the spots: a pale disc under the mossy log and the cattails.
    const mesh = buildMist(new Scene(engine));
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colors = mesh.getVerticesData(VertexBuffer.ColorKind) ?? [];
    let seen = 0;
    let rim = 0;
    for (let v = 0; v < positions.length / 3; v++) {
      const alpha = colors[v * 4 + 3] ?? 0;
      const p = { x: positions[v * 3] ?? 0, z: positions[v * 3 + 2] ?? 0 };
      if (alpha === 0) rim++;
      if (alpha <= 0.005) continue;
      seen++;
      expect(Math.hypot(p.x, p.z), `vertex ${v}`).toBeGreaterThan(bankRadius());
      expect(bankReach(p, SIZE), `vertex ${v}`).toBeGreaterThan(BANK.drop);
    }
    expect(seen).toBeGreaterThan(0);
    expect(rim).toBeGreaterThan(0);
  });

  it('builds the water, the far bank, the jetty and the reeds, inside the mobile budget', () => {
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

describe('river spots on the bank (#621 W1-13)', () => {
  it('puts every spot the server places from the waterline out, so each is padded to its kind', () => {
    for (const at of [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -4, r: 1 },
      { q: 2, r: 5 },
    ]) {
      const spots = searchSpots('river-seed', { ...at, terrain: 'river' }, EXPLORE_RULES) ?? [];
      const land = landField(
        RIVER_LOOK.shape,
        7,
        SIZE,
        START,
        spots.map((s) => ({ x: s.x * SIZE, z: s.z * SIZE, kind: s.kind })),
      );
      expect(spots.length).toBeGreaterThan(0);
      for (const s of spots) {
        expect(bankReach({ x: s.x * SIZE, z: s.z * SIZE }, SIZE)).toBeGreaterThanOrEqual(
          BANK.water - 1e-9,
        );
        expect(land.height(s.x * SIZE, s.z * SIZE), s.kind).toBeCloseTo(
          RIVER.level + (BANK.pads[s.kind] ?? NaN),
          1,
        );
      }
    }
  });
});
