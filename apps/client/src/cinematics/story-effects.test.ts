import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { STORY_EFFECTS } from './cinematic-config.js';
import { heartAt, StoryEffects } from './story-effects.js';

describe('"Your part" effects', () => {
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

  it('puffs hearts up and away: none at the start, rising, then gone', () => {
    const { count, seconds, rise } = STORY_EFFECTS.puff;
    for (let i = 0; i < count; i += 1) {
      expect(heartAt(i, 0).size).toBe(0);
      const mid = heartAt(i, seconds * 0.5);
      expect(mid.dy).toBeGreaterThan(0);
      expect(mid.dy).toBeLessThanOrEqual(rise);
      expect(heartAt(i, seconds * 2).size).toBe(0);
    }
    // The same moment always looks the same (the player can seek).
    expect(heartAt(3, 0.8)).toEqual(heartAt(3, 0.8));
  });

  it('draws each kind as one pooled mesh, and only what shows', () => {
    const scene = new Scene(engine);
    const effects = new StoryEffects(scene, new ImageProcessingConfiguration(), {
      charms: 1,
      puffs: 1,
      joy: 9,
    });
    const meshes = scene.meshes.filter((m) => m.name.startsWith('story-'));
    expect(meshes.map((m) => m.name).sort()).toEqual([
      'story-heart-charm',
      'story-hearts',
      'story-joy',
    ]);
    const pose = { x: 0, y: 0.5, z: 0, scale: 1, yaw: 0, glow: 1 };
    effects.begin();
    effects.charm(pose);
    effects.puff({ x: 0, y: 0.3, z: 0, s: 0.6, glow: 1 });
    for (let i = 0; i < 9; i += 1) effects.joy(pose);
    effects.joy({ ...pose, glow: 0 }); // faded out: not drawn
    effects.end();
    expect(effects.counts.charms).toBe(1);
    expect(effects.counts.hearts).toBeGreaterThan(0);
    expect(effects.counts.joy).toBe(9);
    expect(meshes.every((m) => m.isEnabled())).toBe(true);

    effects.begin();
    effects.end();
    expect(effects.counts).toEqual({ charms: 0, hearts: 0, joy: 0 });
    expect(meshes.some((m) => m.isEnabled())).toBe(false);
  });
});
