import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { ExploreLand } from './explore-land.js';
import { ExploreSky } from './explore-sky.js';
import { skyLook } from './explore-sky-look.js';
import { SKY_LOOKS } from './explore-sky-look.js';
import { LAND_LIGHT, LAND_LOOKS } from './land-config.js';

const engine = new NullEngine();
afterEach(() => {
  for (const scene of [...engine.scenes]) scene.dispose();
});

/** A scene as the explore sky leaves it for `look`: the sun and sky light scaled by the time of day. */
function sceneFor(look = SKY_LOOKS.day) {
  const scene = new Scene(engine);
  const sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  sun.intensity = 1.6 * look.light.sun;
  scene.environmentIntensity = 0.9 * look.light.environment;
  return { scene, sun };
}

function land(scene: Scene, sky = SKY_LOOKS.day, lightBase?: { sun: number; environment: number }) {
  return new ExploreLand(scene, {
    look: LAND_LOOKS['meadow']!,
    seed: 7,
    size: 7,
    colliders: [],
    start: { x: 0, z: -2.94 },
    tier: 'low',
    sky,
    ...(lightBase ? { lightBase } : {}),
  });
}

describe('ExploreLand light (#335)', () => {
  it('sets the sun and sky light from their bases, however often the sky changes', () => {
    const { scene, sun } = sceneFor();
    const meadow = land(scene, SKY_LOOKS.day, { sun: 1.6, environment: 0.9 });
    const day = { sun: sun.intensity, environment: scene.environmentIntensity };
    expect(day.sun).toBeCloseTo(1.6 * LAND_LIGHT.sun, 9);
    expect(day.environment).toBeCloseTo(0.9 * LAND_LIGHT.environment, 9);
    meadow.setSky(SKY_LOOKS.day);
    meadow.setSky(SKY_LOOKS.day);
    expect(sun.intensity).toBeCloseTo(day.sun, 9);
    expect(scene.environmentIntensity).toBeCloseTo(day.environment, 9);
    meadow.setSky(SKY_LOOKS.night);
    expect(sun.intensity).toBeLessThan(day.sun);
    meadow.setSky(SKY_LOOKS.day);
    expect(sun.intensity).toBeCloseTo(day.sun, 9);
    expect(scene.environmentIntensity).toBeCloseTo(day.environment, 9);
  });

  it('works the bases back from the sky when it is not given them', () => {
    const { scene, sun } = sceneFor(SKY_LOOKS.dusk);
    land(scene, SKY_LOOKS.dusk);
    expect(sun.intensity).toBeCloseTo(1.6 * SKY_LOOKS.dusk.light.sun * LAND_LIGHT.sun, 9);
  });

  it('keeps its haze when the sky changes, in the explore scene order (sky, then land)', () => {
    const { scene } = sceneFor();
    const sky = new ExploreSky(scene, SKY_LOOKS.day);
    const meadow = land(scene, SKY_LOOKS.day, sky.lightBase);
    expect(scene.fogMode).toBe(Scene.FOGMODE_LINEAR);
    // A minute's blend towards dusk, as the screen's timer sees it.
    const look = skyLook({ phase: 'day', next: 'dusk', blend: 0.2 });
    sky.set(look);
    meadow.setSky(look);
    expect(scene.fogMode).toBe(Scene.FOGMODE_LINEAR);
    expect(scene.fogStart).toBe(LAND_LIGHT.haze.start);
    expect(scene.fogEnd).toBe(LAND_LIGHT.haze.end);
  });
});
