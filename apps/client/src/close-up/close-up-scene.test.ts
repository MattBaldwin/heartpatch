import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LOD } from '../procedural/config.js';
import type { SquishySpecies } from '../procedural/params.js';
import { CAMERA_FOV, CAMERA_POSES, STAGE } from './close-up-config.js';
import { CloseUpScene } from './close-up-scene.js';
import { cameraFor } from './close-up-view.js';

const registry = visualRegistry(GAME_DATA);
const species: SquishySpecies = {
  id: 'test-puff',
  visual: { body: 'blob', palette: ['#ffb3c7', '#fff4ea'], parts: ['dot-eyes', 'smile'] },
};

describe('CloseUpScene', () => {
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

  function build(lod: 'hero' | 'high' | 'low' = 'hero') {
    const scene = new Scene(engine);
    const camera = new TargetCamera('cam', Vector3.Zero(), scene);
    scene.activeCamera = camera;
    const close = new CloseUpScene(scene, {
      registry,
      lod,
      species,
      instanceId: 'close-1',
      backdrop: null,
      breathing: false,
      // The contact shadow paints a 2D canvas, which NullEngine hasn't got.
      shadows: false,
    });
    return { scene, camera, close };
  }

  it('draws one squishy in hero detail, a few draw calls', () => {
    const { close, scene } = build();
    const stats = close.stats;
    expect(stats).toMatchObject({ squishies: 1, lod: 'hero', backdrop: false });
    // Body, eyes and mouth: draw calls don't grow with detail.
    expect(stats.meshes).toBe(3);
    const body = scene.meshes.find((m) => m.name.startsWith('squishy-body:')) as Mesh;
    const rings = LOD.hero.bodyRings;
    expect(body.getTotalVertices()).toBeGreaterThan(rings * rings * 2);
  });

  it('steps detail down with the quality tier', () => {
    const { close, scene } = build();
    close.setLod('low');
    close.update(0);
    scene.render();
    expect(close.stats.lod).toBe('low');
    const body = scene.meshes.find((m) => m.name.startsWith('squishy-body:') && m.isEnabled());
    expect(body?.name).toContain('-low');
  });

  it('puts the camera where the screen asks, before each render', () => {
    const { close, scene, camera } = build();
    close.setCamera(CAMERA_POSES.face);
    scene.render();
    const want = cameraFor(CAMERA_POSES.face, close.height);
    expect(camera.position.x).toBeCloseTo(want.position.x);
    expect(camera.position.y).toBeCloseTo(want.position.y);
    expect(camera.position.z).toBeCloseTo(want.position.z);
    expect(camera.fov).toBe(CAMERA_FOV);
  });

  it('finds the squishy on screen, near the middle and well sized', () => {
    const { close } = build();
    close.setCamera(CAMERA_POSES.face);
    const view = { width: 390, height: 844, fov: CAMERA_FOV };
    const target = close.target(view)!;
    expect(target.x).toBeCloseTo(195, 0);
    expect(target.y).toBeGreaterThan(200);
    expect(target.y).toBeLessThan(600);
    expect(target.rx).toBeGreaterThan(60);
    expect(close.height).toBeGreaterThan(STAGE.scale * 0.5);
  });

  it('poses for idle moves and comes back to rest', () => {
    const { close, scene } = build();
    const body = () => scene.meshes.find((m) => m.name.startsWith('squishy-body:')) as Mesh;
    close.setPose({ yaw: 0, scale: 1.2, lift: 0.1 });
    scene.render();
    const lifted = body().thinInstanceGetWorldMatrices()[0]!.getTranslation().y;
    expect(lifted).toBeGreaterThan(0);
    close.setPose({ yaw: 0, scale: 1, lift: 0 });
    scene.render();
    expect(body().thinInstanceGetWorldMatrices()[0]!.getTranslation().y).toBeCloseTo(0);
  });
});
