import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
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

describe('house models: the low-tier budget', () => {
  const low = HOUSE_BUDGET.low;

  for (const level of sampleLevels()) {
    for (const zoom of ZOOMS) {
      it(`house level ${String(level)} fits the low tier at zoom ${String(zoom)}`, () => {
        const { scene, house } = buildHouse(level, 'low');
        poseAt(house, zoom);
        const frame = frameCost(scene, house);
        expect(frame.drawCalls).toBeLessThanOrEqual(low.drawCalls);
        expect(frame.triangles).toBeLessThanOrEqual(low.triangles);
        expect(scene.lights.filter((l) => l.isEnabled()).length).toBeLessThanOrEqual(low.lights);
        expect(house.stats.shadowMap).toBe(false);
        scene.getEngine().dispose();
      });
    }
  }

  it('merges a room into a few meshes, not one per piece', () => {
    const { scene, house } = buildHouse(1, 'low');
    expect(house.houseMeshes.length).toBeLessThan(25);
    expect(scene.meshes.filter((m) => m.name === 'house-part')).toHaveLength(0);
    scene.getEngine().dispose();
  });

  for (const level of sampleLevels()) {
    for (const zoom of ZOOMS) {
      it(`house level ${String(level)} keeps the high tier inside its caps at zoom ${String(zoom)}, the shadow pass counted`, () => {
        const { scene, house } = buildHouse(level, 'high');
        poseAt(house, zoom);
        const frame = frameCost(scene, house);
        expect(frame.drawCalls).toBeLessThanOrEqual(HOUSE_BUDGET.high.drawCalls);
        expect(frame.triangles).toBeLessThanOrEqual(HOUSE_BUDGET.high.triangles);
        expect(scene.lights.filter((l) => l.isEnabled()).length).toBeLessThanOrEqual(
          HOUSE_BUDGET.high.lights,
        );
        scene.getEngine().dispose();
      });
    }
  }

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
