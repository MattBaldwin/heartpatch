import { describe, expect, it } from 'vitest';
import { LAND_LIGHT, LAND_LOOKS } from './land-config.js';
import { DEFAULT_TREE_MIX, landLayout, type Growth, type LayoutInput } from './land-layout.js';
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

describe('the kit hooks (#335: the lake, trail and cave build on them)', () => {
  /** FNV-1a over the layout's JSON, without the hook's own field. */
  function fingerprint(layout: ReturnType<typeof landLayout>): string {
    // JSON drops an undefined field, so this is the layout as it was before the hook.
    const s = JSON.stringify({ ...layout, extras: undefined });
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return `${String(h >>> 0)}:${String(s.length)}`;
  }
  const golden = {
    ...input(),
    colliders: [{ x: 2, z: 1, r: 0.32 }],
  };

  it('leaves the meadow exactly as it grew before the hooks', () => {
    // Counts first, so a failure says what moved; then the whole layout.
    const layout = landLayout(golden);
    const counts = {
      tufts: layout.tufts.length,
      daisy: layout.flowers.daisy.length,
      tulip: layout.flowers.tulip.length,
      bell: layout.flowers.bell.length,
      bushes: layout.bushes.length + layout.berryBushes.length,
      oak: layout.trees.oak.length,
      birch: layout.trees.birch.length,
      pine: layout.trees.pine.length,
      shades: layout.shades.length,
    };
    expect(counts).toEqual({
      tufts: 2177,
      daisy: 143,
      tulip: 61,
      bell: 36,
      bushes: 50,
      oak: 20,
      birch: 11,
      pine: 4,
      shades: 202,
    });
    expect(layout.tufts[0]?.x).toBeCloseTo(1.31068, 4);
    expect(layout.tufts[0]?.z).toBeCloseTo(2.68196, 4);
    // Recorded on the approved meadow (v2) before treeMix and extras existed.
    expect(fingerprint(landLayout(golden))).toBe('2135753483:295799');
  });

  it('grows the same meadow with the default tree mix spelled out, and an extras hook adds only its own layer', () => {
    const plain = landLayout(golden);
    const mixed = landLayout({
      ...golden,
      growth: { ...look.growth, treeMix: DEFAULT_TREE_MIX },
      extras: ({ rand, size }) => ({ reeds: [{ x: size * 1.3, z: 0, yaw: rand(), scale: 1 }] }),
    });
    expect(fingerprint(mixed)).toBe(fingerprint(plain));
    expect(plain.extras).toEqual({});
    expect(mixed.extras['reeds']).toHaveLength(1);
  });

  it('follows a biome tree mix', () => {
    const pines = landLayout({
      ...input(),
      growth: { ...look.growth, treeMix: { oak: 0, birch: 0, pine: 1 } },
    });
    expect(pines.trees.oak).toHaveLength(0);
    expect(pines.trees.birch).toHaveLength(0);
    expect(pines.trees.pine.length).toBeGreaterThan(0);
  });
});
