import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { defaultKeeperConfig, KEEPER_DATA } from '@heartpatch/shared';
import { keeperItems } from './keeper-items.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('rebuilds the model at the new detail level, hides it when nobody wears it, and disposes it', () => {
    const scene = new Scene(engine);
    const field = new KeeperField(scene, { data: KEEPER_DATA, lod: 'low', shadows: false });
    const config = defaultKeeperConfig(KEEPER_DATA.bases[0]!);
    const wearers = [0, 1].map((i) =>
      field.add(config, { x: i, z: 0 }, keeperItems(['hollow-man-costume'])),
    );
    field.flush();
    const low = scene.meshes.find((m) => m.name === 'keeper-model-hollow-man-low') as Mesh;
    const lowVertices = low.getTotalVertices();
    field.setLod('high');
    field.flush();
    const high = scene.meshes.find((m) => m.name === 'keeper-model-hollow-man-high') as Mesh;
    expect(high.getTotalVertices()).toBeGreaterThan(lowVertices);
    expect(high.thinInstanceCount).toBe(2);
    expect(scene.meshes.some((m) => m.name === 'keeper-model-hollow-man-low')).toBe(false);
    for (const wearer of wearers) field.remove(wearer);
    field.flush();
    expect(high.isEnabled()).toBe(false);
    field.add(config, { x: 0, z: 0 }, keeperItems(['hollow-man-costume']));
    field.flush();
    field.dispose();
    expect(scene.meshes.some((m) => m.name.startsWith('keeper-model-'))).toBe(false);
  });
});

describe('KeeperField cheers (#501 G)', () => {
  const engine = new NullEngine({
    renderWidth: 390,
    renderHeight: 844,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  it('rewrites the event buffer in place: a cheer makes no new buffers', () => {
    const scene = new Scene(engine);
    const field = new KeeperField(scene, { data: KEEPER_DATA, lod: 'low', shadows: false });
    const config = defaultKeeperConfig(KEEPER_DATA.bases[0]!);
    const keeper = field.add(config, { x: 0, z: 0 });
    field.add(config, { x: 2, z: 0 });
    field.flush();
    const mesh = scene.meshes.find((m) => m.name.startsWith('keeper-')) as Mesh;
    // Babylon has no public read of a user thin-instance buffer; the storage
    // shows whether the same array is kept (rewritten in place).
    const eventBuffer = (): Float32Array | undefined =>
      mesh._userThinInstanceBuffersStorage.data['squishEvent'];
    const events = eventBuffer()!;
    const finishes = events.filter((_, i) => i % 4 === 3);

    const setBuffer = vi.spyOn(Mesh.prototype, 'thinInstanceSetBuffer');
    const made = [
      vi.spyOn(engine, 'createVertexBuffer'),
      vi.spyOn(engine, 'createDynamicVertexBuffer'),
    ];
    const updated = vi.spyOn(Mesh.prototype, 'thinInstanceBufferUpdated');
    field.play(keeper, 'bounce', 1000);
    field.flush();
    field.play(keeper, 'jiggle', 1500);
    field.flush();

    expect(setBuffer).not.toHaveBeenCalled();
    for (const spy of made) expect(spy).not.toHaveBeenCalled();
    expect(updated.mock.calls.every(([kind]) => kind === 'squishEvent')).toBe(true);
    expect(updated).toHaveBeenCalled();
    // Same buffer, now carrying the cheer; finishes are kept.
    expect(eventBuffer()).toBe(events);
    expect(events.some((v, i) => i % 4 === 1 && v !== 0)).toBe(true);
    expect(events.filter((_, i) => i % 4 === 3)).toEqual(finishes);
  });
});
