import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPLORE_SWIM } from './explore-config.js';
import { SwimBubbles } from './swim-bubbles.js';

const engine = new NullEngine();
afterEach(() => {
  for (const scene of [...engine.scenes]) scene.dispose();
});

function bubbles() {
  const scene = new Scene(engine);
  const puffs = new SwimBubbles(scene, 1);
  const mesh = scene.getMeshByName('swim-bubbles') as Mesh;
  return { puffs, mesh };
}

describe('kick bubbles (#399)', () => {
  it('draws nothing until a kick puffs, then one instanced draw while they rise', () => {
    const { puffs, mesh } = bubbles();
    expect(mesh.isEnabled()).toBe(false);
    expect(puffs.step(0)).toBe(false);
    puffs.puff(new Vector3(0, 1, 0), 0);
    expect(mesh.isEnabled()).toBe(true);
    expect(mesh.thinInstanceCount).toBe(EXPLORE_SWIM.bubbles.pool);
    expect(puffs.step(100)).toBe(true);
    expect(puffs.alive).toBe(EXPLORE_SWIM.bubbles.perKick);
  });

  it('pops and switches off soon after the last kick (they never linger)', () => {
    const { puffs, mesh } = bubbles();
    puffs.puff(new Vector3(0, 1, 0), 0);
    const { lifeMs, staggerMs, perKick } = EXPLORE_SWIM.bubbles;
    const gone = lifeMs + staggerMs * (perKick - 1) + 1;
    expect(puffs.step(gone)).toBe(false);
    expect(puffs.alive).toBe(0);
    expect(mesh.isEnabled()).toBe(false);
    // Idle afterwards: nothing to rewrite.
    expect(puffs.step(gone + 1000)).toBe(false);
  });

  it('a kick’s bubbles start apart, so they never merge into one pill', () => {
    const { spread, size } = EXPLORE_SWIM.bubbles;
    // The biggest a bubble grows is 1.1 × its size (0.7 + 0.4 at the top).
    expect(spread).toBeGreaterThan(size * 1.1);
  });
});
