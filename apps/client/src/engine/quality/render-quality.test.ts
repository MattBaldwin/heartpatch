import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { createPostProcessing } from './render-quality.js';

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
