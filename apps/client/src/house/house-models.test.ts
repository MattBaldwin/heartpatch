import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { HOUSE_BUDGET } from './house-config.js';
import { sampleLevels } from './house-fixtures.js';
import { buildCottage } from './house-models.js';
import { buildHouse, cost } from './house-test-scene.js';

// NullEngine has no 2D canvas: plain stand-ins for the painted textures.
vi.mock('../procedural/contact-shadow.js', () => ({
  createContactShadowMesh: (scene: Scene) =>
    CreateGround('test-shadow', { width: 1, height: 1 }, scene),
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
describe('house models: the low-tier budget', () => {
  const low = HOUSE_BUDGET.low;

  for (const level of sampleLevels()) {
    it(`house level ${String(level)} fits the low tier`, () => {
      const { scene, house } = buildHouse(level, 'low');
      scene.render();
      const shell = cost(house.houseMeshes);
      const cast = cost(
        scene.meshes.filter(
          (m): m is Mesh => m instanceof Mesh && /^(squishy-|keeper-)/.test(m.name),
        ),
      );
      expect(shell.drawCalls + cast.drawCalls).toBeLessThanOrEqual(low.drawCalls);
      expect(shell.triangles + cast.triangles).toBeLessThanOrEqual(low.triangles);
      expect(scene.lights.filter((l) => l.isEnabled()).length).toBeLessThanOrEqual(low.lights);
      expect(house.stats.shadowMap).toBe(false);
      scene.getEngine().dispose();
    });
  }

  it('merges a room into a few meshes, not one per piece', () => {
    const { scene, house } = buildHouse(1, 'low');
    expect(house.houseMeshes.length).toBeLessThan(25);
    expect(scene.meshes.filter((m) => m.name === 'house-part')).toHaveLength(0);
    scene.getEngine().dispose();
  });

  it('keeps the high tier inside its own caps', () => {
    for (const level of sampleLevels()) {
      const { scene, house } = buildHouse(level, 'high');
      scene.render();
      const shell = cost(house.houseMeshes);
      expect(shell.drawCalls).toBeLessThanOrEqual(HOUSE_BUDGET.high.drawCalls);
      expect(shell.triangles).toBeLessThanOrEqual(HOUSE_BUDGET.high.triangles);
      expect(scene.lights.filter((l) => l.isEnabled()).length).toBeLessThanOrEqual(
        HOUSE_BUDGET.high.lights,
      );
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
