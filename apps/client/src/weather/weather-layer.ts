import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { MapView } from '@heartpatch/shared';
import { moteShare, type AmbientMode } from '../map/ambient-layout.js';
import { glowMaterial, softDisc } from '../map/map-ambient.js';
import type { MapLayer, MapLayerHost } from '../map/map-screen.js';
import { merged, painted } from '../map/map-props.js';
import { attachTerrainPlugin, DRIFT_ATTRIBUTE } from '../map/terrain-plugin.js';
import type { QualityTier } from '../engine/config.js';
import { attachRain, RAIN_ATTRIBUTE } from './rain-plugin.js';
import { WeatherPlacer, PLACE_EVERY_MS } from './weather-placer.js';
import type { WeatherStore } from './weather-store.js';
import { createWeatherTint } from './weather-tint.js';

// The Wild Isle weather you can see (#621 W1-9): instanced clouds, rain
// streaks and fog over the fronts the server planned, plus a sky wash. Three
// draw calls however big the storm. Cozy Patches build nothing.

export interface WeatherLayerOptions {
  readonly store: WeatherStore;
  readonly tier: () => QualityTier;
  readonly root?: HTMLElement;
}

/** What the layer draws now, for the dev hook and the e2e. */
export interface WeatherStats {
  readonly clouds: number;
  readonly rain: number;
  readonly fog: number;
  readonly mode: AmbientMode;
  readonly placed: number;
}

export interface WeatherLayer extends MapLayer {
  stats(): WeatherStats;
}

/** Hands the layout's fixed arrays to a mesh once; they are refilled in place. */
function instanced(
  mesh: Mesh,
  matrices: Float32Array,
  extra: Float32Array,
  extraName: string,
): void {
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
  mesh.thinInstanceSetBuffer(extraName, extra, 4, true);
  mesh.thinInstanceCount = 1;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;
  mesh.setEnabled(false);
}

export function createWeatherLayer(options: WeatherLayerOptions): WeatherLayer {
  const { store } = options;
  let last: WeatherStats = { clouds: 0, rain: 0, fog: 0, mode: 'off', placed: 0 };

  const layer: WeatherLayer = {
    stats: () => last,
    attach(scene: Scene, view: MapView, host?: MapLayerHost): void {
      store.sync(view);
      if (!host || !store.wild) return;
      const placer = new WeatherPlacer();
      const tint = createWeatherTint(options.root ?? document.body);

      const cloudMat = glowMaterial(scene, 'weather-cloud-mat', '#ffffff', true);
      cloudMat.emissiveColor = Color3.White();
      attachTerrainPlugin(cloudMat, host.clock);
      const cloud = merged('weather-clouds', [
        painted(CreateSphere('wc0', { diameter: 1, segments: 8 }, scene), '#ffffff'),
        painted(CreateSphere('wc1', { diameter: 0.7, segments: 8 }, scene), '#ffffff'),
        painted(CreateSphere('wc2', { diameter: 0.65, segments: 8 }, scene), '#ffffff'),
      ]);
      cloud.hasVertexAlpha = true;
      cloud.material = cloudMat;

      const fogMat = glowMaterial(scene, 'weather-fog-mat', '#eceaf5', true);
      attachTerrainPlugin(fogMat, host.clock);
      const fog = softDisc(scene, 'weather-fog', [
        [0.3, 0.4],
        [0.6, 0.2],
        [0.9, 0],
      ]);
      fog.material = fogMat;

      const rainMat = glowMaterial(scene, 'weather-rain-mat', '#d3dcff', true);
      rainMat.alpha = 0.7;
      rainMat.alphaMode = Constants.ALPHA_COMBINE;
      // GLSL only: without the plugin a streak would just hang there, so it draws none.
      const rainPlugin = attachRain(rainMat, host.clock);
      const rain = CreateCylinder(
        'weather-rain',
        { height: 0.22, diameter: 0.014, tessellation: 3 },
        scene,
      );
      rain.material = rainMat;

      const layout = placer.layout;
      instanced(cloud, layout.cloudMatrices, layout.cloudColours, 'color');
      cloud.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, layout.cloudDrift, 4, true);
      instanced(fog, layout.fogMatrices, layout.fogDrift, DRIFT_ATTRIBUTE);
      instanced(rain, layout.rainMatrices, layout.rainAttrs, RAIN_ATTRIBUTE);

      const show = (mesh: Mesh, count: number, allowed = true): void => {
        const on = allowed && count > 0;
        // Never a count of 0: Babylon would compile the instance-colour shader without instancing.
        mesh.thinInstanceCount = Math.max(1, count);
        mesh.setEnabled(on);
      };
      const refresh = (): void => {
        const mode = host.mode();
        placer.setFronts(store.view?.today.fronts ?? []);
        // Rain shows unless ambient is off (low tier, slow device, WebGPU).
        placer.setRainShare(mode === 'off' || !rainPlugin ? 0 : moteShare(options.tier()));
        const placed = placer.update(store.now());
        tint.set(store.kindNow());
        if (placed || last.mode !== mode) {
          show(cloud, layout.clouds);
          show(fog, layout.fog);
          show(rain, layout.rain);
          for (const m of [cloud, fog, rain]) m.thinInstanceBufferUpdated('matrix');
          cloud.thinInstanceBufferUpdated('color');
          cloud.thinInstanceBufferUpdated(DRIFT_ATTRIBUTE);
          fog.thinInstanceBufferUpdated(DRIFT_ATTRIBUTE);
          rain.thinInstanceBufferUpdated(RAIN_ATTRIBUTE);
          host.invalidate();
        }
        last = {
          clouds: layout.clouds,
          rain: layout.rain,
          fog: layout.fog,
          mode,
          placed: placer.placed,
        };
      };

      const off = store.onChange(refresh);
      const stopStore = store.start();
      const timer = setInterval(refresh, PLACE_EVERY_MS);
      // The mode can change under us (the slow-device judge): poll it, no allocation.
      const watch = scene.onBeforeRenderObservable.add(() => {
        if (host.mode() !== last.mode) refresh();
      });
      scene.onDisposeObservable.add(() => {
        clearInterval(timer);
        stopStore();
        off();
        scene.onBeforeRenderObservable.remove(watch);
        tint.remove();
      });
      refresh();
    },
    update(view: MapView): void {
      store.sync(view);
    },
  };
  return layer;
}
