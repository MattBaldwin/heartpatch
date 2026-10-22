import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry, type HomeResponse } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SquishyField, type SquishyPlacement } from '../procedural/squishy-field.js';
import { HOME_FILL, HOME_FRAME, HOME_VIEW, MOOD_CUES, ROAM, WANDER } from './home-config.js';
import { HomeScene } from './home-scene.js';

// The contact shadow paints a 2D canvas, which NullEngine hasn't got: a plain quad stands in.
vi.mock('../procedural/contact-shadow.js', () => ({
  createContactShadowMesh: (scene: Scene) =>
    CreateGround('test-shadow', { width: 1, height: 1 }, scene),
}));

const HABITAT = '0190a8c4-0000-7000-8000-000000000102';
const SQUISHY = '0190a8c4-0000-7000-8000-000000000201';
const species = GAME_DATA.species[0]!;

const home: HomeResponse = {
  tiles: [{ q: 0, r: 0, heartSeed: true, nodeResource: null }],
  buildings: [
    {
      id: HABITAT,
      buildingId: 'cozy-meadow',
      kind: 'habitat',
      level: 1,
      spot: 2,
      lit: null,
      safeRadius: null,
      q: 0,
      r: 0,
      nightsLeft: null,
      fuelSpace: null,
      capacity: 3,
      residents: 1,
    },
  ],
  squishies: [
    {
      id: SQUISHY,
      speciesId: species.id,
      element: species.element,
      feeling: 'cozy',
      nickname: null,
      level: 1,
      habitatId: HABITAT,
      trainingId: null,
      job: 'resting',
      accessory: null,
      houseRoomId: null,
    },
  ],
  speciesDefs: [],
  items: {},
  seasons: ['halloween'],
  tonight: '2026-10-02',
  now: '2026-10-02T12:00:00.000Z',
};

/** Where a squishy's face points (+x, +z) for a yaw: its front is −z at yaw 0. */
function forward(yaw: number): { x: number; z: number } {
  const v = new Vector3(0, 0, -1).rotateByQuaternionToRef(
    Quaternion.RotationAxis(Vector3.Up(), yaw),
    new Vector3(),
  );
  return { x: v.x, z: v.z };
}

describe('home scene wandering', () => {
  let engine: NullEngine | null = null;
  afterEach(() => {
    vi.restoreAllMocks();
    engine?.dispose();
    engine = null;
  });

  it('turns a hopping squishy to face the way it walks', () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const homeScene = new HomeScene(scene, home, {
      registry: visualRegistry(GAME_DATA),
      lod: 'low',
      keeper: null,
    });
    homeScene.update(home);
    const moves: SquishyPlacement[] = [];
    vi.spyOn(SquishyField.prototype, 'move').mockImplementation((_h, p) => {
      moves.push(p);
    });

    let checked = 0;
    for (let hop = 0; hop < 6; hop++) {
      const start = hop * WANDER.hopMs * 2;
      homeScene.hop(SQUISHY, start);
      moves.length = 0;
      homeScene.step(start + WANDER.hopMs * 0.25);
      homeScene.step(start + WANDER.hopMs * 0.75);
      const [a, b] = moves;
      const dx = b!.x - a!.x;
      const dz = b!.z - a!.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const face = forward(b!.yaw ?? 0);
      expect(face.x).toBeCloseTo(dx / len, 5);
      expect(face.z).toBeCloseTo(dz / len, 5);
      homeScene.step(start + WANDER.hopMs);
      if (Math.abs(dx / len) > 0.2) checked++;
    }
    // At least one hop went sideways, where a mirrored yaw shows.
    expect(checked).toBeGreaterThan(0);
  });
});

describe('home scene: the Keeper’s house cottage (#381)', () => {
  let engine: NullEngine | null = null;
  afterEach(() => {
    engine?.dispose();
    engine = null;
  });

  const build = (house: HomeResponse['house']) => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const homeScene = new HomeScene(
      scene,
      { ...home, ...(house ? { house } : {}) },
      {
        registry: visualRegistry(GAME_DATA),
        lod: 'low',
        keeper: null,
      },
    );
    return { scene, homeScene };
  };

  it('draws no cottage while the house is switched off (no `house` in the reply)', () => {
    const { scene, homeScene } = build(undefined);
    expect(homeScene.stats.house).toBeNull();
    expect(scene.meshes.some((m) => m.name.startsWith('house-cottage'))).toBe(false);
  });

  it('draws the cottage for the house’s level, and swaps it when the house grows', () => {
    const { scene, homeScene } = build({ level: 1 });
    expect(homeScene.stats.house).toBe('hut');
    homeScene.update({ ...home, house: { level: 4 } });
    expect(homeScene.stats.house).toBe('heart-tree');
    const cottages = scene.meshes.filter(
      (m) => m.name.startsWith('house-cottage') && !m.isDisposed(),
    );
    expect(cottages).toHaveLength(1);
    // The old cottage's material goes with it: a swap never leaks one.
    const mats = () => scene.materials.filter((m) => m.name === 'home-cottage-mat').length;
    expect(mats()).toBe(1);
    homeScene.update(home);
    expect(homeScene.stats.house).toBeNull();
    expect(mats()).toBe(0);
  });
});

describe('home scene mood cues (#393)', () => {
  let engine: NullEngine | null = null;
  afterEach(() => {
    vi.restoreAllMocks();
    engine?.dispose();
    engine = null;
  });

  const make = () => {
    engine = new NullEngine();
    return new HomeScene(new Scene(engine), home, {
      registry: visualRegistry(GAME_DATA),
      lod: 'low',
      keeper: null,
    });
  };

  it('droops a squishy that is not keen, which then sits still, and stands it up again', () => {
    const homeScene = make();
    const moves: SquishyPlacement[] = [];
    vi.spyOn(SquishyField.prototype, 'move').mockImplementation((_h, p) => {
      moves.push(p);
    });
    homeScene.setMoods(new Map([[SQUISHY, 'meh']]));
    expect(moves.at(-1)?.squash).toBe(MOOD_CUES.droop);
    expect(homeScene.faceOf(SQUISHY)).toBe('glum');
    expect(homeScene.stats).toMatchObject({ drooping: 1, happy: 0 });
    expect(homeScene.wanderers).toEqual([]);
    // The same mood again moves nothing.
    homeScene.setMoods(new Map([[SQUISHY, 'meh']]));
    expect(moves).toHaveLength(1);
    homeScene.setMoods(new Map());
    expect(moves.at(-1)?.squash).toBeUndefined();
    expect(homeScene.faceOf(SQUISHY)).toBeNull();
    expect(homeScene.wanderers).toEqual([SQUISHY]);
  });

  it('bounces only a happy squishy, through the shared bounce with no new draw calls', () => {
    const homeScene = make();
    const plays: string[] = [];
    vi.spyOn(SquishyField.prototype, 'play').mockImplementation((_h, move) => {
      plays.push(move);
    });
    homeScene.cheer(SQUISHY, 0);
    expect(plays).toEqual([]);
    homeScene.setMoods(new Map([[SQUISHY, 'loves']]));
    expect(homeScene.happy).toEqual([SQUISHY]);
    homeScene.cheer(SQUISHY, 0);
    expect(plays).toEqual(['bounce']);
    expect(homeScene.stats).toMatchObject({ happy: 1, drooping: 0, cheers: 1 });
  });

  it('keeps a mood set before the squishies arrive, and puts a bubble over its head', () => {
    const homeScene = make();
    homeScene.setMoods(new Map([[SQUISHY, 'loves']]));
    homeScene.update({ ...home, squishies: [] });
    expect(homeScene.happy).toEqual([]);
    homeScene.update(home);
    expect(homeScene.happy).toEqual([SQUISHY]);
    const top = new Vector3();
    const foot = new Vector3();
    expect(homeScene.headAndFeet(SQUISHY, top, foot)).toBe(true);
    expect(top.y).toBeGreaterThan(foot.y);
    expect(top.x).toBe(foot.x);
    expect(homeScene.drawOrder).toEqual([SQUISHY]);
    expect(homeScene.headAndFeet('nobody', top, foot)).toBe(false);
  });
});

describe('home scene: the house’s tile and who’s home (#604)', () => {
  let engine: NullEngine | null = null;
  afterEach(() => {
    engine?.dispose();
    engine = null;
  });

  const RING = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ] as const;
  const id = (n: number) => `0190a8c4-0000-7000-8000-${String(n).padStart(12, '0')}`;
  const squishy = (n: number, extra: Partial<HomeResponse['squishies'][number]> = {}) => ({
    ...home.squishies[0]!,
    id: id(300 + n),
    habitatId: null,
    ...extra,
  });
  const full: HomeResponse = {
    ...home,
    tiles: [
      { q: 0, r: 0, heartSeed: true, nodeResource: null },
      ...RING.map(([q, r]) => ({ q, r, heartSeed: false, nodeResource: null })),
    ],
    buildings: [{ ...home.buildings[0]!, q: 1, r: 0, spot: 2 }],
    squishies: [
      squishy(1),
      squishy(2, { job: 'team' }),
      squishy(3, { job: 'gatherer' }),
      squishy(4, { job: 'guard' }),
      squishy(5, { habitatId: HABITAT }),
      // Training out on a homestead (#277): its grounds aren't drawn at home.
      squishy(6, { job: 'training', trainingId: id(130) }),
    ],
    house: { level: 1 },
  };
  const make = (reply: HomeResponse) => {
    engine = new NullEngine();
    return new HomeScene(new Scene(engine), reply, {
      registry: visualRegistry(GAME_DATA),
      lod: 'low',
      keeper: null,
    });
  };

  it('fills the back-right ring tile with the cottage, or the next free one', () => {
    expect(make(full).stats.houseTile).toEqual({ q: 1, r: -1 });
    const older = make({
      ...full,
      buildings: [...full.buildings, { ...home.buildings[0]!, id: id(103), q: 1, r: -1, spot: 2 }],
    });
    expect(older.stats.houseTile).toEqual({ q: 0, r: -1 });
    // Every ring tile built on: it stays by the Heart Seed, as before.
    const packed = make({
      ...full,
      buildings: RING.map(([q, r], i) => ({
        ...home.buildings[0]!,
        id: id(110 + i),
        q,
        r,
        spot: 2,
      })),
    });
    expect(packed.stats).toMatchObject({ house: 'hut', houseTile: null });
  });

  it('leaves gatherers, guards and homestead trainees out, and every other squishy wanders', () => {
    const homeScene = make(full);
    expect(homeScene.stats).toMatchObject({ squishies: 3, housed: 1, away: 3 });
    expect(new Set(homeScene.wanderers)).toEqual(new Set([id(301), id(302), id(305)]));
  });

  it('starts the camera towards the house, so it shows under the top card', () => {
    const homeScene = make(full);
    const house = homeScene.spotAt({ q: 1, r: -1, spot: 0 });
    // NullEngine has no canvas: a short screen's share.
    expect(homeScene.content.start?.z).toBeCloseTo(house.z * HOME_FRAME.short, 5);
    expect(homeScene.content.start?.x).toBe(0);
    // No house tile: the Heart Seed, as before.
    expect(make(home).content.start).toEqual({ x: 0, z: 0 });
  });

  it('keeps roamers off the Heart Seed tile while a building or the cottage stands there', () => {
    const top = new Vector3();
    const foot = new Vector3();
    const seedAt = (homeScene: HomeScene) => homeScene.spotAt({ q: 0, r: 0, spot: 0 });
    const onSeedTile = (homeScene: HomeScene, n: number) => {
      homeScene.headAndFeet(id(300 + n), top, foot);
      const c = seedAt(homeScene);
      return Math.hypot(foot.x - c.x, foot.z - c.z) < ROAM.far * HOME_VIEW.hexSize + 1e-9;
    };
    // A habitat on one of the Heart Seed tile's spots (it doesn't fill the tile).
    const seedHabitat = make({
      ...full,
      buildings: [...full.buildings, { ...home.buildings[0]!, id: id(120), q: 0, r: 0, spot: 2 }],
    });
    // Every ring tile built on: the cottage stands by the Heart Seed.
    const packed = make({
      ...full,
      buildings: [
        ...RING.map(([q, r], i) => ({ ...home.buildings[0]!, id: id(110 + i), q, r, spot: 2 })),
        { ...home.buildings[0]!, id: HABITAT, q: 1, r: 0, spot: 2 },
      ].filter((b, i, all) => all.findIndex((x) => x.q === b.q && x.r === b.r) === i),
    });
    expect(packed.stats.houseTile).toBeNull();
    for (const n of [1, 2]) {
      for (let hop = 0; hop < 8; hop++) {
        const at = hop * WANDER.hopMs * 2;
        seedHabitat.hop(id(300 + n), at);
        seedHabitat.step(at + WANDER.hopMs);
        expect(onSeedTile(seedHabitat, n)).toBe(false);
      }
    }
    // The cottage takes the Heart Seed tile too, so with nowhere else free
    // they make do there.
    expect(onSeedTile(packed, 1)).toBe(true);
  });

  it('turns a roamer at most `WANDER.turn` round its tile’s middle each hop', () => {
    const homeScene = make(full);
    const top = new Vector3();
    const foot = new Vector3();
    const angleAt = (n: number, c: { x: number; z: number }) => {
      homeScene.headAndFeet(id(300 + n), top, foot);
      return Math.atan2(foot.z - c.z, foot.x - c.x);
    };
    // Its anchor: the free tile middle nearest where it stands.
    homeScene.headAndFeet(id(301), top, foot);
    const middles = [[0, 0], ...RING].map(([q, r]) => homeScene.spotAt({ q, r, spot: 0 }));
    const c = middles.reduce((a, b) =>
      Math.hypot(b.x - foot.x, b.z - foot.z) < Math.hypot(a.x - foot.x, a.z - foot.z) ? b : a,
    );
    for (let hop = 0; hop < 10; hop++) {
      const before = angleAt(1, c);
      const at = hop * WANDER.hopMs * 2;
      homeScene.hop(id(301), at);
      homeScene.step(at + WANDER.hopMs);
      let d = Math.abs(angleAt(1, c) - before);
      if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d).toBeLessThanOrEqual(WANDER.turn + 1e-9);
    }
  });

  it('keeps a tile-sized habitat’s residents off its fence and inside its tile', () => {
    const homeScene = make(full);
    const top = new Vector3();
    const foot = new Vector3();
    const den = homeScene.spotAt({ q: 1, r: 0, spot: 0 });
    for (let hop = 0; hop < 12; hop++) {
      const at = hop * WANDER.hopMs * 2;
      homeScene.hop(id(305), at);
      homeScene.step(at + WANDER.hopMs);
      homeScene.headAndFeet(id(305), top, foot);
      const d = Math.hypot(foot.x - den.x, foot.z - den.z);
      expect(d).toBeGreaterThanOrEqual(HOME_FILL.wander.near - 1e-9);
      expect(d).toBeLessThanOrEqual(HOME_FILL.wander.far + 1e-9);
    }
  });

  it('roams a free home tile, never the house’s or a habitat’s', () => {
    const homeScene = make(full);
    const top = new Vector3();
    const foot = new Vector3();
    const tileOf = (p: { x: number; z: number }) => {
      // The nearest home tile's middle.
      let best = '';
      let bestD = Infinity;
      for (const [q, r] of [[0, 0], ...RING]) {
        const c = homeScene.spotAt({ q, r, spot: 0 });
        const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = `${String(q)},${String(r)}`;
        }
      }
      return best;
    };
    for (const n of [1, 2]) {
      for (let hop = 0; hop < 8; hop++) {
        const at = hop * WANDER.hopMs * 2;
        homeScene.hop(id(300 + n), at);
        homeScene.step(at + WANDER.hopMs);
        expect(homeScene.headAndFeet(id(300 + n), top, foot)).toBe(true);
        expect(['1,-1', '1,0']).not.toContain(tileOf(foot));
        // Well inside its own tile: far plus half a squishy stays clear of the edge.
        const [q, r] = tileOf(foot).split(',').map(Number) as [number, number];
        const c = homeScene.spotAt({ q, r, spot: 0 });
        expect(Math.hypot(foot.x - c.x, foot.z - c.z)).toBeLessThanOrEqual(
          ROAM.far * HOME_VIEW.hexSize + 1e-9,
        );
        expect(homeScene.tucked(id(300 + n))).toBe(false);
      }
    }
  });
});
