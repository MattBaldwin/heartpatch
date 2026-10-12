import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { QualityTier } from '../engine/config.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { blend, fitHouse, kidPose } from './house-camera.js';
import { HOUSE_BUDGET } from './house-config.js';
import { sampleHouse, sampleLevels } from './house-fixtures.js';
import { buildCottage } from './house-models.js';
import { hasRoomBuilder } from './house-rooms.js';
import type { HouseScene } from './house-scene.js';
import { buildHouse, cost } from './house-test-scene.js';

// NullEngine has no 2D canvas: a plain quad, under the real mesh's name so it's counted.
vi.mock('../procedural/contact-shadow.js', () => ({
  createContactShadowMesh: (scene: Scene) =>
    CreateGround('squishy-shadows', { width: 1, height: 1 }, scene),
}));
vi.mock('./house-textures.js', async () => {
  const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial');
  return {
    duskPaneMaterial: (scene: Scene) => new StandardMaterial('test-pane', scene),
    signMaterial: (scene: Scene) => new StandardMaterial('test-sign', scene),
    radialTexture: () => null,
  };
});

/**
 * The older iPad holds exactly 30 fps (coordinator, 2026-10-11), so the low
 * tier is binding: every level's shell and fixtures, with a full house of
 * residents and the Keeper, stays inside its draw calls and triangles,
 * counted on a NullEngine (plan §1c). house-shots records the real frames.
 */
/** The iPhone the kid-height cases stand in for (CSS px, HUD bands). */
const PHONE = { width: 390, height: 844, top: 80, bottom: 150 };

/** The dollhouse (0), passing the front wall (0.75) and standing in the room (1). */
const ZOOMS = [0, 0.75, 1] as const;

/** Poses the camera `zoom` of the way from the dollhouse to kid height, as the screen does. */
function poseAt(house: HouseScene, zoom: number): void {
  const doll = fitHouse(house.bounds, PHONE);
  house.setPose(blend(doll, kidPose(house.focusRoom!, PHONE), zoom), zoom);
}

/** Shell plus cast, plus the shadow pass when there is one (every caster draws once more). */
function frameCost(scene: Scene, house: HouseScene): { drawCalls: number; triangles: number } {
  scene.render();
  const casters = scene.lights
    .map((l) => l.getShadowGenerator()?.getShadowMap()?.renderList ?? [])
    .flat()
    .filter((m): m is Mesh => m instanceof Mesh);
  const parts = [
    cost(house.houseMeshes),
    cost(
      scene.meshes.filter(
        (m): m is Mesh => m instanceof Mesh && /^(squishy-|keeper-)/.test(m.name),
      ),
    ),
    cost(casters),
  ];
  return {
    drawCalls: parts.reduce((n, c) => n + c.drawCalls, 0),
    triangles: parts.reduce((n, c) => n + c.triangles, 0),
  };
}

/**
 * Every frame the house can show: each floor of the dollhouse (the floor
 * cut), the entry glide's heaviest frame (the roof still on, upstairs fading out with it),
 * and the walk in to kid height, which is on the ground floor.
 */
function framesOf(level: number): { label: string; floor: number; zoom: number; roof: number }[] {
  const floors = [...new Set(sampleHouse(level).view.rooms.map((r) => r.layout.floor))].sort();
  return [
    // The glide's heaviest frame: the dollhouse pose with the roof still on and upstairs fading.
    { label: 'the dollhouse mid-glide (roof at 0.3)', floor: 0, zoom: 0, roof: 0.3 },
    ...ZOOMS.map((zoom) => ({ label: `floor 0 at zoom ${String(zoom)}`, floor: 0, zoom, roof: 1 })),
    ...floors
      .filter((f) => f > 0)
      .map((f) => ({ label: `floor ${String(f)}`, floor: f, zoom: 0, roof: 1 })),
  ];
}

/** Builds the house and shows it as `frame` says, as the screen does. */
function shown(level: number, tier: QualityTier, frame: ReturnType<typeof framesOf>[number]) {
  const built = buildHouse(level, tier);
  built.house.setFloor(frame.floor);
  built.house.setRoof(frame.roof);
  poseAt(built.house, frame.zoom);
  return built;
}

/**
 * B4 headroom: the low and high tiers keep about a tenth of their caps
 * spare (the older iPad holds exactly 30 fps), so a later PR can add a
 * little without the top level going over.
 */
const HEADROOM = 0.9; // TUNE

describe('house models: the budget, every tier, every floor', () => {
  for (const tier of ['low', 'medium', 'high'] as const) {
    const cap = HOUSE_BUDGET[tier];
    const keep = tier === 'medium' ? 1 : HEADROOM;
    for (const level of sampleLevels()) {
      for (const frame of framesOf(level)) {
        it(`house level ${String(level)} fits the ${tier} tier: ${frame.label}, the shadow pass counted`, () => {
          const { scene, house } = shown(level, tier, frame);
          const cost = frameCost(scene, house);
          expect(cost.drawCalls).toBeLessThanOrEqual(Math.floor(cap.drawCalls * keep));
          expect(cost.triangles).toBeLessThanOrEqual(cap.triangles * keep);
          expect(scene.lights.filter((l) => l.isEnabled()).length).toBeLessThanOrEqual(cap.lights);
          expect(house.stats.shadowMap).toBe(tier !== 'low');
          scene.getEngine().dispose();
        });
      }
    }
  }

  it('merges a room into a few meshes, not one per piece', () => {
    const { scene, house } = buildHouse(1, 'low');
    expect(house.houseMeshes.length).toBeLessThan(25);
    expect(scene.meshes.filter((m) => m.name === 'house-part')).toHaveLength(0);
    scene.getEngine().dispose();
  });

  it('keeps little pieces out of the shadow pass (they cast nothing you’d see)', () => {
    const { scene, house } = buildHouse(sampleLevels().at(-1)!, 'high');
    scene.render();
    const casters = scene.lights.flatMap(
      (l) => l.getShadowGenerator()?.getShadowMap()?.renderList ?? [],
    );
    const small = house.houseMeshes.filter((m) => /^house-f\d+-small$/.test(m.name));
    expect(small.length).toBeGreaterThan(0);
    for (const m of small) expect(casters).not.toContain(m);
    expect(casters.map((m) => m.name)).toContain('house-f0-solid');
    scene.getEngine().dispose();
  });

  it('furnishes every room with its own builder, so the budget cases count the real rooms (B3)', () => {
    const top = sampleLevels().at(-1)!;
    for (const room of sampleHouse(top).view.rooms) expect(hasRoomBuilder(room.look)).toBe(true);
  });

  it('merges glowing bits into one mesh per floor, not one per room, at every tier', () => {
    const top = sampleLevels().at(-1)!;
    for (const tier of ['low', 'medium', 'high'] as const) {
      const { scene, house } = buildHouse(top, tier);
      const glows = house.houseMeshes.filter((m) => /^house-glow-f\d+$/.test(m.name));
      const floors = new Set(sampleHouse(top).view.rooms.map((r) => r.layout.floor));
      expect(glows.length).toBeLessThanOrEqual(floors.size);
      const rooms = sampleHouse(top).view.rooms.map((r) => `house-${r.id}-glow`);
      expect(house.houseMeshes.filter((m) => rooms.includes(m.name))).toEqual([]);
      // Low: nothing upstairs glows (the Kitchen's stove fire is solid), so floor 1 draws no glow.
      if (tier === 'low')
        expect(glows.filter((m) => m.isEnabled()).map((m) => m.name)).toEqual(['house-glow-f0']);
      scene.getEngine().dispose();
    }
  });

  it('builds a cottage for every exterior, as one mesh', () => {
    const { scene } = buildHouse(1, 'low');
    for (const exterior of ['hut', 'wing', 'loft', 'heart-tree'] as const) {
      const cottage = buildCottage(scene, exterior);
      expect(cottage.getTotalIndices()).toBeGreaterThan(0);
      expect(cottage.name).toBe(`house-cottage-${exterior}`);
    }
    scene.getEngine().dispose();
  });
});
