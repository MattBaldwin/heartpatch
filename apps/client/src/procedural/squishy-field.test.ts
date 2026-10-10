import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { CLOTHING_BY_ID, GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { SQUISH_LOOK_CODE, type SquishyLod } from './config.js';
import type { SquishySpecies } from './params.js';
import { SquishyField } from './squishy-field.js';

const registry = visualRegistry(GAME_DATA);
const species: SquishySpecies = {
  id: 'test-puff',
  visual: { body: 'blob', palette: ['#ffb3c7', '#fff4ea'], parts: ['dot-eyes', 'smile'] },
};

describe('SquishyField shadow look (owner decision 7)', () => {
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

  function field() {
    const scene = new Scene(engine);
    // The contact shadow paints a 2D canvas, which NullEngine hasn't got.
    return {
      scene,
      field: new SquishyField<SquishyLod>(scene, { registry, lod: 'low', shadows: false }),
    };
  }

  /** Each instance's look code (`squishMotion.w`) on the mesh whose name starts with `prefix`. */
  function looks(scene: Scene, prefix: string): number[] {
    const mesh = scene.meshes.find((m) => m.name.startsWith(prefix)) as Mesh;
    const data = mesh.getVertexBuffer('squishMotion')?.getData() as Float32Array;
    return Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + 3]!);
  }

  it('tints a rescue guardian on the same meshes and draw calls, eyes apart', () => {
    const { scene, field: f } = field();
    f.add(species, 'mine', { x: -1, z: 0 });
    const alone = f.stats.meshes;
    const shadow = f.add(species, 'shadow-1', { x: 1, z: 0 }, 'shadow');
    expect(shadow.look).toBe('shadow');
    const stats = f.stats;
    // No extra draw calls: body, eyes and mouth meshes are shared.
    expect(stats).toMatchObject({ squishies: 2, meshes: alone, shadowLook: 1 });

    const { normal, shadow: tint, shadowEyes } = SQUISH_LOOK_CODE;
    expect(looks(scene, 'squishy-body:')).toEqual([normal, tint]);
    // The mouth is tinted like the body; the eyes and their glints (the
    // ellipsoid batch) read glassy.
    expect(looks(scene, 'squishy-part:arc')).toEqual([normal, tint]);
    expect(looks(scene, 'squishy-part:ellipsoid')).toEqual([
      ...Array<number>(4).fill(normal),
      ...Array<number>(4).fill(shadowEyes),
    ]);
  });

  it('draws everyone normally by default, and forgets the look on remove', () => {
    const { scene, field: f } = field();
    const a = f.add(species, 'a', { x: 0, z: 0 });
    expect(a.look).toBe('normal');
    const b = f.add(species, 'b', { x: 1, z: 0 }, 'shadow');
    f.remove(b);
    expect(f.stats.shadowLook).toBe(0);
    expect(looks(scene, 'squishy-body:')).toEqual([SQUISH_LOOK_CODE.normal]);
  });

  it('lifts and squashes the body for a hop (#317), about its feet', () => {
    const { scene, field: f } = field();
    const body = () =>
      (scene.meshes.find((m) => m.name.startsWith('squishy-body:')) as Mesh)
        .thinInstanceGetWorldMatrices()[0]!
        .clone();
    const h = f.add(species, 'hop', { x: 0, z: 0, y: 0.5 });
    f.flush();
    const rest = body();
    f.move(h, { x: 0, z: 0, y: 0.5, lift: 0.2, squash: 0.8 });
    f.flush();
    const hop = body();
    // Up by the lift plus the squashed body's own offset above the feet.
    const restUp = rest.m[13]! - 0.5;
    expect(hop.m[13]! - 0.5).toBeCloseTo(0.2 + restUp * 0.8);
    // Shorter and wider, keeping the volume.
    expect(hop.m[5]! / rest.m[5]!).toBeCloseTo(0.8);
    expect(hop.m[0]! / rest.m[0]!).toBeCloseTo(1 / Math.sqrt(0.8));
    // The middle the camera and close-ups aim at rides along.
    expect(f.centre(h)!.y).toBeCloseTo(0.2 + 0.5 + h.params.height / 2);
  });

  it('moves in place: picking and a rebuilt detail level both see the new spot (#323)', () => {
    const { scene, field: f } = field();
    const h = f.add(species, 'mover', { x: 0, z: 0 });
    f.flush();
    const body = () =>
      scene.meshes.find((m) => m.name.startsWith('squishy-body:') && m.isEnabled()) as Mesh;
    f.move(h, { x: 2, z: -1 });
    f.flush();
    // The world matrices picking reads follow the move.
    expect(body().thinInstanceGetWorldMatrices()[0]!.m[12]).toBeCloseTo(2);
    expect(f.centre(h)!.x).toBeCloseTo(2);
    // A new detail level rebuilds the meshes at the moved spot, and moves after it still land.
    f.setLod('high');
    f.flush();
    expect(body().thinInstanceGetWorldMatrices()[0]!.m[12]).toBeCloseTo(2);
    f.move(h, { x: -1, z: 3 });
    f.flush();
    const m = body().thinInstanceGetWorldMatrices()[0]!;
    expect([m.m[12], m.m[14]]).toEqual([expect.closeTo(-1), expect.closeTo(3)]);
  });
});

describe('SquishyField accessories (#340)', () => {
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

  const item = (id: string) => CLOTHING_BY_ID.get(id)!;
  // A squishy with its own topper (a `crown` part): Gourdon's stem.
  const gourdon = GAME_DATA.species.find((s) => s.id === 'gourdon')!;
  const field = () =>
    new SquishyField<SquishyLod>(new Scene(engine), { registry, lod: 'low', shadows: false });

  it('puts a piece on as more part instances, and takes it off again', () => {
    const f = field();
    const h = f.add(species, 'a', { x: 0, z: 0 });
    const bare = f.stats;
    f.setAccessory(h, item('snuggle-scarf'));
    expect(f.accessoryOf(h)).toBe('snuggle-scarf');
    expect(f.stats.instances).toBe(bare.instances + item('snuggle-scarf').visual.pieces.length);
    // A scarf adds nothing above the head.
    expect(f.heightOf(h)).toBe(h.params.height);
    f.setAccessory(h, null);
    expect(f.accessoryOf(h)).toBeNull();
    expect(f.stats).toEqual(bare);
  });

  it('swaps one piece for another, and a hat stands taller', () => {
    const f = field();
    const h = f.add(species, 'a', { x: 0, z: 0 });
    const bare = f.stats.instances;
    f.setAccessory(h, item('tiny-bow'));
    f.setAccessory(h, item('tiny-top-hat'));
    expect(f.accessoryOf(h)).toBe('tiny-top-hat');
    expect(f.stats.instances).toBe(bare + item('tiny-top-hat').visual.pieces.length);
    expect(f.heightOf(h)).toBeGreaterThan(h.params.height);
  });

  it('tucks its own topper away under a hat and brings it back', () => {
    const f = field();
    const h = f.add(gourdon, 'g', { x: 0, z: 0 });
    const bare = f.stats.instances;
    const stem = h.params.parts
      .filter((p) => p.slot === 'crown')
      .reduce((n, p) => n + p.placements.length, 0);
    expect(stem).toBeGreaterThan(0);
    const hat = item('tiny-witch-hat');
    f.setAccessory(h, hat);
    expect(f.stats.instances).toBe(bare - stem + hat.visual.pieces.length);
    // A scarf isn't a hat: the stem comes back.
    f.setAccessory(h, item('snuggle-scarf'));
    expect(f.stats.instances).toBe(bare + item('snuggle-scarf').visual.pieces.length);
    f.setAccessory(h, null);
    expect(f.stats.instances).toBe(bare);
  });

  it('never dresses a rescue guardian', () => {
    const f = field();
    const h = f.add(species, 's', { x: 0, z: 0 }, 'shadow');
    const bare = f.stats;
    f.setAccessory(h, item('tiny-crown'));
    expect(f.accessoryOf(h)).toBeNull();
    expect(f.stats).toEqual(bare);
  });
});
