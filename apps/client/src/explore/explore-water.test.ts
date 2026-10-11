import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { ExploreLand } from './explore-land.js';
import { skyLook } from './explore-sky-look.js';
import { ExploreWater } from './explore-water.js';
import { LAKE_LOOKS, WATER_HAZE, WATER_LOOKS_BY_TERRAIN } from './lake-config.js';

const engine = new NullEngine();
afterEach(() => {
  for (const scene of [...engine.scenes]) scene.dispose();
});

const underwater = skyLook({ phase: 'day', next: 'day', blend: 0 }, true);
const start = { x: 0, z: -2.94 };

function lake() {
  const scene = new Scene(engine);
  new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  const land = new ExploreLand(scene, {
    look: LAKE_LOOKS['lake']!,
    seed: 5,
    size: 7,
    colliders: [],
    start,
    tier: 'high',
    sky: underwater,
    lightBase: { sun: 1.6, environment: 0.9 },
  });
  const water = new ExploreWater(scene, land, {
    look: WATER_LOOKS_BY_TERRAIN['lake']!,
    seed: 5,
    size: 7,
    start,
    springs: [{ x: 2, z: 1 }],
    tier: 'high',
    sky: underwater,
  });
  return { scene, land, water };
}

describe('ExploreWater (#335)', () => {
  it('shows its fish and bubbles only while ambient life runs, like the meadow motes', () => {
    const { water } = lake();
    for (const mode of ['off', 'still'] as const) {
      water.setAmbient(mode);
      expect(water.stats.layers['fish']).toBe(0);
      expect(water.stats.layers['bubbles']).toBe(0);
    }
    water.setAmbient('live');
    expect(water.stats.layers['fish']).toBeGreaterThan(0);
    expect(water.stats.layers['bubbles']).toBeGreaterThan(0);
  });

  it('sets the water haze after the land, every time the sky changes', () => {
    const { scene, land, water } = lake();
    land.setSky(underwater);
    water.setSky(underwater);
    expect(scene.fogMode).toBe(Scene.FOGMODE_LINEAR);
    expect(scene.fogStart).toBe(WATER_HAZE.start);
    expect(scene.fogEnd).toBe(WATER_HAZE.end);
  });
});
