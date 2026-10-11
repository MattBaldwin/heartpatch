import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { defaultKeeperConfig, KEEPER_DATA } from '@heartpatch/shared';
import { keeperItems } from './keeper-items.js';
import { afterEach, describe, expect, it } from 'vitest';
import { KeeperField } from './keeper-field.js';

describe('KeeperField hop placement (#317)', () => {
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

  it('lifts and squashes the Keeper about its feet, and keeps its middle with it', () => {
    const scene = new Scene(engine);
    // The contact shadow paints a 2D canvas, which NullEngine hasn't got.
    const field = new KeeperField(scene, { data: KEEPER_DATA, lod: 'low', shadows: false });
    const config = defaultKeeperConfig(KEEPER_DATA.bases[0]!);
    const h = field.add(config, { x: 0, z: 0, y: 0.5, scale: 0.75 });
    field.flush();
    const mesh = scene.meshes.find((m) => m.name.startsWith('keeper-')) as Mesh;
    const rest = mesh.thinInstanceGetWorldMatrices().map((m) => m.clone());
    field.move(h, { x: 0, z: 0, y: 0.5, scale: 0.75, lift: 0.1, squash: 0.9 });
    field.flush();
    const hop = mesh.thinInstanceGetWorldMatrices();
    rest.forEach((r, i) => {
      const m = hop[i]!;
      // Each piece rises by the lift plus its squashed height above the feet.
      expect(m.m[13]! - 0.5).toBeCloseTo(0.1 + (r.m[13]! - 0.5) * 0.9);
      // Sideways it spreads out from the feet, keeping the volume.
      expect(m.m[12]!).toBeCloseTo(r.m[12]! / Math.sqrt(0.9));
    });
    const tall = h.params.height * 0.75;
    expect(field.centre(h)!.y).toBeCloseTo(0.5 + 0.1 + tall / 2);
  });
});

describe('KeeperField costume models', () => {
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

  it('draws the Hollow Man costume as one extra mesh, shared by every wearer', () => {
    const scene = new Scene(engine);
    const field = new KeeperField(scene, { data: KEEPER_DATA, lod: 'low', shadows: false });
    const config = defaultKeeperConfig(KEEPER_DATA.bases[0]!);
    field.add(config, { x: 0, z: 0 });
    const before = field.stats;
    for (let i = 0; i < 4; i++) {
      field.add(config, { x: i + 1, z: 0 }, keeperItems(['hollow-man-costume']));
    }
    const { meshes, instances } = field.stats;
    // His cloak and arms are one mesh, however many wear him; the eyes share the ellipsoids.
    expect(meshes).toBe(before.meshes + 1);
    const model = scene.meshes.find((m) => m.name === 'keeper-model-hollow-man-low') as Mesh;
    expect(model.thinInstanceCount).toBe(4);
    // Three pieces a wearer (cloak and arms, two eyes): far fewer than Marigold Calavera's 26.
    expect(instances - before.instances).toBe(4 * 3);
    expect(model.getTotalVertices()).toBeGreaterThan(0);
  });
});
