import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Scene } from '@babylonjs/core/scene';
import type { MapView, WeatherFront, WeatherKind, WeatherView } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerrainClock } from '../map/terrain-plugin.js';
import type { MapLayerHost } from '../map/map-screen.js';
import { createWeatherLayer } from './weather-layer.js';
import type { WeatherStore } from './weather-store.js';

// The tint is DOM, which the unit tests haven't got: a stand-in that counts.
const tints = vi.hoisted(() => ({ made: 0, removed: 0 }));
vi.mock('./weather-tint.js', () => ({
  createWeatherTint: () => {
    tints.made += 1;
    return {
      node: null,
      set: () => undefined,
      remove: () => {
        tints.removed += 1;
      },
    };
  },
}));

const START = Date.parse('2026-10-25T10:00:00Z');
const NOW = START + 3_600_000;
const storm: WeatherFront = {
  id: 'a',
  kind: 'storm',
  from: { q: -3, r: 0 },
  to: { q: 3, r: 0 },
  startAt: new Date(START).toISOString(),
  endAt: new Date(START + 4 * 3_600_000).toISOString(),
  radius: 3,
};

/** Just the store the layer reads, with a sky the test turns on and off. */
function fakeStore() {
  const listeners = new Set<() => void>();
  const sky = { fronts: [] as WeatherFront[], kind: 'clear' as WeatherKind };
  const store = {
    wild: true,
    home: { q: 0, r: 0 },
    get view() {
      return { today: { fronts: sky.fronts } } as unknown as WeatherView;
    },
    now: () => NOW,
    kindNow: () => sky.kind,
    sync: () => undefined,
    start: () => () => undefined,
    onChange(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const set = (stormy: boolean): void => {
    sky.fronts = stormy ? [storm] : [];
    sky.kind = stormy ? 'storm' : 'clear';
    for (const fn of listeners) fn();
  };
  return { store: store as unknown as WeatherStore, set, listeners };
}

describe('createWeatherLayer', () => {
  let engine: NullEngine;
  let scene: Scene;
  let sun: DirectionalLight;
  const host: MapLayerHost = {
    clock: new TerrainClock(),
    mode: () => 'live',
    invalidate: () => undefined,
  };
  const view = {} as MapView;
  const root = {} as HTMLElement;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
    sun.intensity = 1;
    tints.made = 0;
    tints.removed = 0;
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it('makes its storm light once, so a storm never changes the light count', () => {
    const lit = CreateBox('lit', {}, scene);
    lit.material = new StandardMaterial('lit-mat', scene);
    const { store, set } = fakeStore();
    createWeatherLayer({ store, tier: () => 'medium', root }).attach(scene, view, host);
    const lights = scene.lights.length;
    const sources = lit.lightSources.length;
    const hemi = scene.getLightByName('weather-flash');
    expect(hemi?.isEnabled()).toBe(true);
    expect(hemi?.intensity).toBe(0);
    expect(lit.lightSources).toContain(hemi);

    set(true);
    expect(sun.intensity).toBeLessThan(1);
    expect(hemi?.intensity).toBeGreaterThan(0);
    set(false);
    set(true);
    expect(scene.lights.length).toBe(lights);
    expect(lit.lightSources.length).toBe(sources);
    expect(hemi?.isEnabled()).toBe(true);
    set(false);
    expect(hemi?.intensity).toBe(0);
    expect(sun.intensity).toBeCloseTo(1);
  });

  it('stops with the scene', () => {
    const { store, listeners } = fakeStore();
    createWeatherLayer({ store, tier: () => 'medium', root }).attach(scene, view, host);
    expect(listeners.size).toBe(1);
    scene.dispose();
    expect(listeners.size).toBe(0);
    expect(tints.removed).toBe(1);
  });

  it('undoes everything it made when it throws part-way', async () => {
    const { store, set, listeners } = fakeStore();
    set(true);
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    const lights = scene.lights.length;
    const observers = scene.onBeforeRenderObservable.observers.length;
    const disposers = scene.onDisposeObservable.observers.length;
    const env = scene.environmentIntensity;
    // The first refresh is the last step of attaching, and its last call is
    // `invalidate`: everything is made, and the storm has dimmed the sun.
    const failing: MapLayerHost = {
      ...host,
      invalidate: () => {
        expect(sun.intensity).toBeLessThan(1);
        throw new Error('boom');
      },
    };
    const layer = createWeatherLayer({ store, tier: () => 'medium', root });
    expect(() => {
      layer.attach(scene, view, failing);
    }).toThrow('boom');
    // Babylon drops a removed observer on the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scene.meshes.length).toBe(meshes);
    expect(scene.materials.length).toBe(materials);
    expect(scene.lights.length).toBe(lights);
    expect(scene.onBeforeRenderObservable.observers.length).toBe(observers);
    expect(scene.onDisposeObservable.observers.length).toBe(disposers);
    expect(listeners.size).toBe(0);
    expect(tints).toEqual({ made: 1, removed: 1 });
    expect(sun.intensity).toBe(1);
    expect(scene.environmentIntensity).toBe(env);
    expect(layer.stats().clouds).toBe(0);
  });
});
