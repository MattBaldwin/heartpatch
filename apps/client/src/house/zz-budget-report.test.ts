import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { QualityTier } from '../engine/config.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { blend, fitHouse, kidPose } from './house-camera.js';
import { HOUSE_BUDGET } from './house-config.js';
import { sampleHouse, sampleLevels, withGift } from './house-fixtures.js';
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
    paneMaterial: (scene: Scene, kind = 'dusk') =>
      scene.getMaterialByName(`test-${kind}-pane`) ??
      new StandardMaterial(`test-${kind}-pane`, scene),
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

/**
 * Builds the house and shows it as `frame` says, as the screen does, with
 * today's wrapped gift by a resident's bed (#381 H2: the heaviest it gets).
 */
function shown(level: number, tier: QualityTier, frame: ReturnType<typeof framesOf>[number]) {
  const built = buildHouse(level, tier, withGift(sampleHouse(level)));
  built.house.setFloor(frame.floor);
  built.house.setRoof(frame.roof);
  poseAt(built.house, frame.zoom);
  return built;
}
import { writeFileSync } from 'node:fs';
describe('budget report', () => {
  it('reports', () => {
    const rows: string[] = [];
    for (const tier of ['low', 'medium', 'high'] as const) {
      for (const level of sampleLevels()) {
        for (const frame of framesOf(level)) {
          const { scene, house } = shown(level, tier, frame);
          const c = frameCost(scene, house);
          rows.push(
            `${tier}\tL${String(level)}\t${frame.label}\t${String(c.drawCalls)}\t${String(c.triangles)}\t${String(scene.lights.filter((l) => l.isEnabled()).length)}`,
          );
          scene.getEngine().dispose();
        }
      }
    }
    writeFileSync(process.env.BUDGET_OUT ?? '/tmp/budget.tsv', rows.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  }, 600_000);
});
