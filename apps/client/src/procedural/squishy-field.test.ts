import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { SQUISH_LOOK_CODE } from './config.js';
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
    return { scene, field: new SquishyField(scene, { registry, lod: 'low', shadows: false }) };
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
});
