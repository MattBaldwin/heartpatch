import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { MapView } from '@heartpatch/shared';
import { moteShare, type AmbientMode } from '../map/ambient-layout.js';
import { glowMaterial, softDisc } from '../map/map-ambient.js';
import type { MapLayer, MapLayerHost } from '../map/map-screen.js';
import { attachTerrainPlugin, DRIFT_ATTRIBUTE } from '../map/terrain-plugin.js';
import type { QualityTier } from '../engine/config.js';
import { attachCloudShade } from './cloud-plugin.js';
import { attachRain, RAIN_ATTRIBUTE } from './rain-plugin.js';
import { buildBolt, buildCloud } from './weather-clouds.js';
import { WEATHER_LOOK } from './weather-config.js';
import { FULL_CLOUDS } from './weather-layout.js';
import { WeatherPlacer, PLACE_EVERY_MS } from './weather-placer.js';
import type { WeatherStore } from './weather-store.js';
import { createWeatherTint } from './weather-tint.js';

// The Wild Isle weather you can see (#621 W1-9): instanced clouds, rain
// streaks, fog, cloud shadows and a storm's lightning over the fronts the
// server planned, plus a sky wash. Five draw calls however big the storm. Cozy Patches build nothing.

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

/**
 * Hands the layout's fixed arrays to a mesh once; they are refilled in place.
 * The GPU buffers must be updatable (`staticBuffer` false): a static one
 * ignores `thinInstanceBufferUpdated`, so it would keep the all-zero first
 * fill and draw nothing.
 */
function instanced(
  mesh: Mesh,
  matrices: Float32Array,
  extra: Float32Array,
  extraName: string,
): void {
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
  mesh.thinInstanceSetBuffer(extraName, extra, 4, false);
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
      // Writes depth, so where a cloud's puffs overlap it is drawn once: one
      // soft shape, never rings of see-through balls.
      cloudMat.disableDepthWrite = false;
      attachTerrainPlugin(cloudMat, host.clock);
      // One fused cushion shape with a flat belly; its light comes from the
      // cloud plugin (GLSL), since the material itself is unlit.
      attachCloudShade(cloudMat);
      const cloud = buildCloud(scene);
      cloud.hasVertexAlpha = true;
      cloud.material = cloudMat;

      // Each cloud's soft shadow on the tiles, one flat disc apiece.
      const shadowMat = glowMaterial(
        scene,
        'weather-shadow-mat',
        WEATHER_LOOK.clouds.shadow.colour,
        true,
      );
      shadowMat.backFaceCulling = false;
      attachTerrainPlugin(shadowMat, host.clock);
      const shadow = softDisc(scene, 'weather-shadow', WEATHER_LOOK.clouds.shadow.rings);
      shadow.material = shadowMat;

      const fogMat = glowMaterial(scene, 'weather-fog-mat', WEATHER_LOOK.fog.colour, true);
      // The disc is seen from above whichever way its triangles wind.
      fogMat.backFaceCulling = false;
      attachTerrainPlugin(fogMat, host.clock);
      const fog = softDisc(scene, 'weather-fog', WEATHER_LOOK.fog.rings);
      fog.material = fogMat;

      const look = WEATHER_LOOK.rain;
      const rainMat = glowMaterial(scene, 'weather-rain-mat', look.colour, true);
      rainMat.alpha = look.alpha;
      rainMat.alphaMode = Constants.ALPHA_COMBINE;
      // GLSL only: without the plugin a streak would just hang there, so it draws none.
      const rainPlugin = attachRain(rainMat, host.clock);
      const rain = CreateCylinder(
        'weather-rain',
        { height: look.height, diameter: look.diameter, tessellation: 3 },
        scene,
      );
      rain.material = rainMat;

      // Lightning: a zig-zag bolt that flashes under a storm's lower deck (or
      // holds still when motion is off). Same plugin as the rain, GLSL only.
      const boltLook = WEATHER_LOOK.storm.bolts;
      const boltMat = glowMaterial(scene, 'weather-bolt-mat', boltLook.colour, true);
      boltMat.alpha = boltLook.alpha;
      boltMat.alphaMode = Constants.ALPHA_COMBINE;
      boltMat.backFaceCulling = false;
      const boltPlugin = attachRain(boltMat, host.clock);
      const bolt = buildBolt(scene, boltLook.width);
      bolt.material = boltMat;

      const layout = placer.layout;
      instanced(cloud, layout.cloudMatrices, layout.cloudColours, 'color');
      cloud.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, layout.cloudDrift, 4, false);
      instanced(shadow, layout.shadowMatrices, layout.shadowColours, 'color');
      instanced(bolt, layout.boltMatrices, layout.boltAttrs, RAIN_ATTRIBUTE);
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
        // Rain by tier (none on low) where the plugin runs (not WebGPU). A slow
        // device's ambient goes `off` a few seconds in, which stops the clock:
        // the streaks then hold still, as under reduced motion, rather than
        // vanish (#621). A still mesh costs nothing between frames.
        const tier = options.tier();
        placer.setRainShare(rainPlugin ? moteShare(tier) : 0);
        // The low tier drops plain rain, but a storm keeps a lighter one: it is what makes it a storm.
        placer.setStormSky({
          storm: rainPlugin
            ? Math.max(moteShare(tier), tier === 'low' ? WEATHER_LOOK.lowTier.stormRain : 0)
            : 0,
          still: mode !== 'live',
        });
        // The low tier's clouds are fewer and lighter, as well as rainless.
        placer.setClouds(tier === 'low' ? WEATHER_LOOK.lowTier : FULL_CLOUDS);
        const placed = placer.update(store.now());
        tint.set(store.kindNow());
        if (placed || last.mode !== mode) {
          show(cloud, layout.clouds);
          show(fog, layout.fog);
          show(rain, layout.rain);
          show(shadow, layout.clouds);
          show(bolt, layout.bolts, boltPlugin !== null);
          for (const m of [cloud, shadow, fog, rain, bolt]) m.thinInstanceBufferUpdated('matrix');
          shadow.thinInstanceBufferUpdated('color');
          bolt.thinInstanceBufferUpdated(RAIN_ATTRIBUTE);
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
