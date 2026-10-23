import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LEVEL_SCALE } from './building-config.js';
import { buildBuildingModel, levelScale } from './building-models.js';

const RESOURCE = GAME_DATA.buildings.filter((b) => b.kind === 'resource').map((b) => b.id);

describe('resource building models (#601 PR 7)', () => {
  const engine = new NullEngine({
    renderWidth: 390,
    renderHeight: 844,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  const vertices = (scene: Scene, id: string, level: number, look: 'plain' | 'out' = 'plain') => {
    const { body, glow } = buildBuildingModel(scene, id, look, level);
    return { body: body.getTotalVertices(), glow: glow?.getTotalVertices() ?? 0, mesh: body };
  };

  it('gives LEVEL_SCALE a fourth step, each taller than the last', () => {
    expect(LEVEL_SCALE).toHaveLength(4);
    expect(levelScale(4).up).toBeGreaterThan(levelScale(3).up);
    expect(levelScale(9)).toEqual(levelScale(4));
  });

  it('has its own model for each of the seven, not the plain marker', () => {
    const scene = new Scene(engine);
    const marker = vertices(scene, 'no-such-building', 1).body;
    expect(RESOURCE).toHaveLength(7);
    for (const id of RESOURCE) expect(vertices(scene, id, 1).body, id).toBeGreaterThan(marker);
  });

  it('adds detail at every level, L1 to L4, and stands taller', () => {
    const scene = new Scene(engine);
    for (const id of RESOURCE) {
      const sizes = [1, 2, 3, 4].map((l) => {
        const v = vertices(scene, id, l);
        return { parts: v.body + v.glow, height: v.mesh.getBoundingInfo().boundingBox.maximum.y };
      });
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]?.parts, `${id} L${String(i + 1)}`).toBeGreaterThan(
          sizes[i - 1]?.parts ?? 0,
        );
        expect(sizes[i]?.height, `${id} L${String(i + 1)}`).toBeGreaterThan(
          sizes[i - 1]?.height ?? 0,
        );
      }
    }
  });

  it('glows while it works and goes dark while it naps', () => {
    const scene = new Scene(engine);
    for (const id of RESOURCE) {
      expect(vertices(scene, id, 1, 'plain').glow, id).toBeGreaterThan(0);
      expect(vertices(scene, id, 1, 'out').glow, id).toBe(0);
    }
  });

  it('draws the Warehouse (PR 9) as its own toy that glows awake and goes dark asleep', () => {
    const scene = new Scene(engine);
    const marker = vertices(scene, 'no-such-building', 1).body;
    expect(vertices(scene, 'warehouse', 1).body).toBeGreaterThan(marker);
    expect(vertices(scene, 'warehouse', 1, 'plain').glow).toBeGreaterThan(0);
    expect(vertices(scene, 'warehouse', 1, 'out').glow).toBe(0);
    const before = scene.meshes.length;
    buildBuildingModel(scene, 'warehouse', 'plain', 1);
    expect(scene.meshes.length - before).toBeLessThanOrEqual(2);
  });

  it('is one body mesh and at most one glow mesh, so a kind is one or two draw calls', () => {
    const scene = new Scene(engine);
    const before = scene.meshes.length;
    buildBuildingModel(scene, 'greenhouse', 'plain', 4);
    expect(scene.meshes.length - before).toBeLessThanOrEqual(2);
  });
});
