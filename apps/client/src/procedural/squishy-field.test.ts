import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3, type Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';
import { CLOTHING_BY_ID, GAME_DATA, visualRegistry, type Floater } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { FINISH_CODE, FLOATER_BATCH, SQUISH_LOOK_CODE, type SquishyLod } from './config.js';
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

describe('SquishyField floaters', () => {
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

  const floater: Floater = {
    glyph: 'music-note',
    size: 0.4,
    above: 0.08,
    side: 0.42,
    color: 'detail',
    bob: { height: 0.04, speed: 0.45 },
  };
  const singer: SquishySpecies = {
    id: 'test-singer',
    visual: { ...species.visual, palette: ['#9a70f0', '#ffd0e6', '#1e0a2e', '#ffb627'], floater },
  };

  function field(options: { breathing?: boolean; parent?: TransformNode } = {}) {
    const scene = new Scene(engine);
    const camera = new FreeCamera('camera', new Vector3(0, 2, -8), scene);
    camera.setTarget(new Vector3(0, 1, 0));
    const f = new SquishyField<SquishyLod>(scene, {
      registry,
      lod: 'low',
      shadows: false,
      ...options,
    });
    return { scene, camera, field: f };
  }
  const floaterMesh = (scene: Scene) =>
    scene.meshes.find((m) => m.name.startsWith(`squishy-${FLOATER_BATCH}`)) as Mesh | undefined;
  const noteMatrix = (scene: Scene, i = 0) =>
    floaterMesh(scene)!.thinInstanceGetWorldMatrices()[i]!.clone();
  /** The note's world matrix: its instance matrix under the mesh's parent (a battle rig). */
  const noteWorld = (scene: Scene, i = 0) =>
    noteMatrix(scene, i).multiply(floaterMesh(scene)!.computeWorldMatrix(true));
  const axis = (m: Matrix, row: number) =>
    new Vector3(m.m[row * 4], m.m[row * 4 + 1], m.m[row * 4 + 2]).normalize();

  it('costs nothing until a squishy with a floater is on screen', () => {
    const { scene, field: f } = field();
    f.add(species, 'plain', { x: 0, z: 0 });
    expect(f.stats.floaters).toBe(0);
    expect(floaterMesh(scene)).toBeUndefined();
  });

  it('adds one draw call for any number of floaters, and drops it when they go', () => {
    const { scene, field: f } = field();
    f.add(species, 'plain', { x: 0, z: 0 });
    const before = f.stats.meshes;
    const a = f.add(singer, 'a', { x: -2, z: 0 });
    // The singer's body and face are shared meshes: only the note is new.
    expect(f.stats).toMatchObject({ floaters: 1, meshes: before + 1 });
    const b = f.add(singer, 'b', { x: 2, z: 0 });
    expect(f.stats).toMatchObject({ floaters: 2, meshes: before + 1 });
    expect(floaterMesh(scene)!.thinInstanceCount).toBe(2);
    f.remove(a);
    f.remove(b);
    expect(f.stats).toMatchObject({ floaters: 0, meshes: before });
    expect(floaterMesh(scene)!.isEnabled()).toBe(false);
    f.dispose();
    expect(floaterMesh(scene)).toBeUndefined();
  });

  it('never floats over a rescue guardian (the shadow look)', () => {
    const { field: f } = field();
    f.add(singer, 'guardian', { x: 0, z: 0 }, 'shadow');
    expect(f.stats.floaters).toBe(0);
  });

  it('uses the shared vinyl, its outline in vertex colours, and casts no contact shadow', () => {
    const { scene, field: f } = field();
    f.add(singer, 'a', { x: 0, z: 0 });
    f.flush();
    const mesh = floaterMesh(scene)!;
    const body = scene.meshes.find((m) => m.name.startsWith('squishy-body:'))!;
    expect(mesh.material).toBe(body.material);
    expect(mesh.material?.fogEnabled).toBe(body.material?.fogEnabled);
    expect(mesh.isVerticesDataPresent('color')).toBe(true);
    expect(mesh.isPickable).toBe(false);
  });

  it('faces the camera straight on and from a 40° battle turn', () => {
    const { scene, camera, field: f } = field();
    for (const yaw of [0, (40 * Math.PI) / 180]) {
      const h = f.add(singer, `yaw-${yaw}`, { x: 0, z: 0, yaw });
      scene.render();
      const m = noteWorld(scene);
      const forward = camera.getDirection(Vector3.Forward());
      expect(Vector3.Dot(axis(m, 2), forward)).toBeCloseTo(1, 5);
      expect(Vector3.Dot(axis(m, 1), camera.getDirection(Vector3.Up()))).toBeCloseTo(1, 5);
      f.remove(h);
    }
  });

  it('faces the camera from under a turned battle rig', () => {
    const { scene, camera } = field();
    const rig = new TransformNode('rig', scene);
    rig.rotation.y = 1.1;
    rig.position.set(1, 0, 2);
    const f = new SquishyField<SquishyLod>(scene, {
      registry,
      lod: 'low',
      shadows: false,
      breathing: false,
      parent: rig,
    });
    const h = f.add(singer, 'rig', { x: 0, z: 0 });
    scene.render();
    const m = noteWorld(scene);
    expect(Vector3.Dot(axis(m, 2), camera.getDirection(Vector3.Forward()))).toBeCloseTo(1, 5);
    // Still beside its squishy: the rig carries it, turned with the squishy.
    const at = Vector3.TransformCoordinates(
      new Vector3(...h.params.floater!.at),
      rig.computeWorldMatrix(true),
    );
    expect(m.getTranslation().subtract(at).length()).toBeLessThan(1e-5);
  });

  /** A battle rig like battle-scene's: the pose scale on `tilt`, the field under `turn`. */
  function rigged() {
    const { scene } = field();
    const tilt = new TransformNode('tilt', scene);
    const turn = new TransformNode('turn', scene);
    turn.parent = tilt;
    tilt.position.set(1, 0, 2);
    turn.rotation.y = 0.7;
    const f = new SquishyField<SquishyLod>(scene, {
      registry,
      lod: 'low',
      shadows: false,
      breathing: false,
      parent: turn,
    });
    const h = f.add(singer, 'rig', { x: 0, z: 0, scale: 2.7 });
    const body = () => {
      const mesh = scene.meshes.find((m) => m.name.startsWith('squishy-body:')) as Mesh;
      const m = mesh.thinInstanceGetWorldMatrices()[0]!.multiply(mesh.computeWorldMatrix(true));
      return Math.hypot(m.m[4]!, m.m[5]!, m.m[6]!);
    };
    /** The note's world height (its mesh is one unit tall) and place. */
    const note = () => {
      scene.render();
      const m = noteWorld(scene);
      return { height: Math.hypot(m.m[4]!, m.m[5]!, m.m[6]!), at: m.getTranslation() };
    };
    return { tilt, turn, h, body, note };
  }

  it('shrinks and vanishes with its squishy when a battle rig scales it', () => {
    const { tilt, body, note } = rigged();
    const full = { note: note().height, body: body() };
    expect(full.note).toBeGreaterThan(0.5);
    for (const k of [0.2, 0.001]) {
      tilt.scaling.setAll(k);
      const now = note();
      expect(now.height / full.note, `rig ${k}`).toBeCloseTo(k, 5);
      expect(body() / full.body, `rig ${k}`).toBeCloseTo(k, 5);
    }
    expect(note().height).toBeLessThan(0.01);
  });

  it('keeps its size through a rig’s squash and stretch, and stays beside the body', () => {
    const { tilt, turn, h, note } = rigged();
    const full = note().height;
    // Volume-keeping squash, as battle-scene poses it.
    tilt.scaling.set(1 / Math.sqrt(0.7), 0.7, 1 / Math.sqrt(0.7));
    const squashed = note();
    expect(squashed.height).toBeCloseTo(full, 5);
    // Its place goes through the rig like the body's vertices do.
    const at = Vector3.TransformCoordinates(
      new Vector3(...h.params.floater!.at).scale(2.7),
      turn.computeWorldMatrix(true),
    );
    expect(squashed.at.subtract(at).length()).toBeLessThan(1e-4);
  });

  it('floats above and to the viewer’s right of its squishy, and follows it', () => {
    const { scene, field: f } = field({ breathing: false });
    const h = f.add(singer, 'a', { x: 0, z: 0 });
    scene.render();
    const rest = noteMatrix(scene);
    expect(rest.m[12]).toBeGreaterThan(0);
    expect(rest.m[13]).toBeGreaterThan(h.params.height);
    f.move(h, { x: 3, z: 1, lift: 0.5, scale: 2 });
    scene.render();
    const moved = noteMatrix(scene);
    expect(moved.m[12]! - 3).toBeCloseTo(rest.m[12]! * 2, 5);
    expect(moved.m[13]).toBeCloseTo(rest.m[13]! * 2 + 0.5, 5);
    expect(axis(moved, 0).length()).toBeCloseTo(1);
    expect(Math.hypot(moved.m[4]!, moved.m[5]!, moved.m[6]!)).toBeCloseTo(
      h.params.floater!.size * 2,
    );
  });

  it('bobs while the field breathes, and holds still with reduced motion', () => {
    const at = (breathing: boolean) => {
      const { scene, field: f } = field({ breathing });
      f.add(singer, 'a', { x: 0, z: 0 });
      return [0, 400, 900].map((ms) => {
        f.update(1000 + ms);
        scene.render();
        return noteMatrix(scene).m[13]!;
      });
    };
    const bobbing = at(true);
    expect(new Set(bobbing).size).toBe(3);
    const still = at(false);
    expect(still[1]).toBe(still[0]);
    expect(still[2]).toBe(still[0]);
  });

  it('rebuilds with the rest of the squishy at a new detail level', () => {
    const { scene, field: f } = field();
    f.add(singer, 'a', { x: 0, z: 0 });
    f.flush();
    const low = floaterMesh(scene)!.getTotalVertices();
    f.setLod('high');
    f.flush();
    const high = scene.meshes.find(
      (m) => m.name.startsWith(`squishy-${FLOATER_BATCH}`) && m.name.endsWith('-high'),
    ) as Mesh;
    expect(high.getTotalVertices()).toBeGreaterThan(low);
    expect(f.stats.floaters).toBe(1);
  });
});

describe('SquishyField sparkle kept off a face', () => {
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

  /** Every instance's `squishEvent.w` (finish code) across the scene's squishy meshes. */
  function codes(scene: Scene): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const mesh of scene.meshes) {
      const data = (mesh as Mesh).getVertexBuffer('squishEvent')?.getData() as
        Float32Array | undefined;
      if (!data || !mesh.isEnabled()) continue;
      out.set(
        mesh.name,
        Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + 3]!),
      );
    }
    return out;
  }

  it('marks only the body of a sparkly species that asks', () => {
    const scene = new Scene(engine);
    const f = new SquishyField<SquishyLod>(scene, { registry, lod: 'low', shadows: false });
    const visual = { ...species.visual, finish: 'iridescent' as const };
    f.add({ id: 'asks', visual: { ...visual, sparkleOffFace: true } }, 'a', { x: 0, z: 0 });
    f.flush();
    const all = codes(scene);
    const body = [...all].find(([name]) => name.startsWith('squishy-body:'))![1];
    expect(body).toEqual([FINISH_CODE.iridescent + FINISH_CODE.offFace]);
    for (const [name, list] of all) {
      if (name.startsWith('squishy-body:')) continue;
      for (const code of list) expect(code, name).toBeLessThan(FINISH_CODE.offFace);
    }
    // Plain vinyl has no flecks to keep off: no bit.
    f.add({ id: 'plain', visual: { ...species.visual, sparkleOffFace: true } }, 'b', {
      x: 2,
      z: 0,
    });
    f.flush();
    const bodies = [...codes(scene)].find(([name]) => name.startsWith('squishy-body:'))![1];
    expect(bodies).toContain(FINISH_CODE.vinyl);
  });

  it('leaves every public species’ codes as they were (no off-face bit)', () => {
    const scene = new Scene(engine);
    const f = new SquishyField<SquishyLod>(scene, { registry, lod: 'low', shadows: false });
    GAME_DATA.species.forEach((s, i) => f.add(s, `pub-${i}`, { x: i, z: 0 }));
    f.flush();
    for (const [name, list] of codes(scene)) {
      for (const code of list) expect(code, name).toBeLessThan(FINISH_CODE.offFace);
    }
  });
});
