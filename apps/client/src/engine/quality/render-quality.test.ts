import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostProcessing, RenderQuality } from './render-quality.js';

describe('createPostProcessing', () => {
  const engine = new NullEngine();
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  function setup() {
    const scene = new Scene(engine);
    const camera = new TargetCamera('cam', Vector3.Zero(), scene);
    const pipeline = createPostProcessing(scene, camera);
    return { scene, camera, pipeline };
  }

  it('tone-maps inside the materials, not as a post-process', () => {
    const { scene } = setup();
    const ip = scene.imageProcessingConfiguration;
    expect(ip.isEnabled).toBe(true);
    expect(ip.applyByPostProcess).toBe(false);
    expect(ip.toneMappingEnabled).toBe(true);
  });

  it('uses 8-bit targets with FXAA and no MSAA', () => {
    const { pipeline, camera } = setup();
    expect(pipeline.samples).toBe(1);
    expect(pipeline.fxaaEnabled).toBe(true);
    const names = camera._postProcesses.map((p) => p?.name);
    expect(names).not.toContain('imageProcessing');
  });
});

describe('RenderQuality', () => {
  const engine = new NullEngine();
  // Client unit tests run in Node: just the bits of the DOM it listens to.
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 2, addEventListener: vi.fn() });
    vi.stubGlobal('document', { addEventListener: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  it('asks for a rescale after a draw, and only applies it when told (#260)', () => {
    const scene = new Scene(engine);
    const quality = new RenderQuality(
      scene,
      new TargetCamera('cam', Vector3.Zero(), scene),
      'high',
    );
    const scaling = vi.spyOn(engine, 'setHardwareScalingLevel');
    // 25 fps, past the grace and a whole window: the governor wants less.
    let asked = false;
    for (let i = 0; i < 500 && !asked; i++) asked = quality.sample(40);
    expect(asked).toBe(true);
    // sample() runs right after a draw: resizing the canvas then would clear
    // the frame about to be shown.
    expect(scaling).not.toHaveBeenCalled();
    expect(quality.applyPending()).toBe(true);
    expect(scaling).toHaveBeenCalledTimes(1);
    expect(quality.snapshot.renderScale).toBeLessThan(1);
    expect(quality.applyPending()).toBe(false);
  });

  it('holds a pinned tier at full resolution, however slow (dev captures, #335)', () => {
    const scene = new Scene(engine);
    const quality = new RenderQuality(
      scene,
      new TargetCamera('cam', Vector3.Zero(), scene),
      'high',
      true,
    );
    // A software renderer: seconds a frame, which would crawl straight to low.
    for (let i = 0; i < 50; i++) expect(quality.sample(2000)).toBe(false);
    expect(quality.applyPending()).toBe(false);
    expect(quality.snapshot).toMatchObject({ tier: 'high', renderScale: 1, pinned: true });
  });
});
