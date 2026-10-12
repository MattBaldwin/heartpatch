import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry, type HomeResponse } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SquishyField, type SquishyPlacement } from '../procedural/squishy-field.js';
import { MOOD_CUES, WANDER } from './home-config.js';
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
