import { Constants } from '@babylonjs/core/Engines/constants';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { hexToWorld, type MapView } from '@heartpatch/shared';
import { moteShare, type AmbientMode } from '../map/ambient-layout.js';
import { glowMaterial, softDisc } from '../map/map-ambient.js';
import { HEX_SIZE, HOME_LOOK } from '../map/map-config.js';
import type { MapLayer, MapLayerHost } from '../map/map-screen.js';
import { KEEPER_PLACES } from '../procedural/keeper/keeper-config.js';
import { attachTerrainPlugin, DRIFT_ATTRIBUTE } from '../map/terrain-plugin.js';
import type { QualityTier } from '../engine/config.js';
import { attachCloudShade, type CloudFlash } from './cloud-plugin.js';
import { attachRain, RAIN_ATTRIBUTE } from './rain-plugin.js';
import { buildBank, buildBolt, buildCloud } from './weather-clouds.js';
import { WEATHER_LOOK } from './weather-config.js';
import { skyFlash } from './weather-flash.js';
import { FULL_CLOUDS } from './weather-layout.js';
import { WeatherPlacer, PLACE_EVERY_MS } from './weather-placer.js';
import type { WeatherStore } from './weather-store.js';
import { createWeatherTint } from './weather-tint.js';

// The Wild Isle weather you can see (#621 W1-9): instanced clouds, a storm's
// banks, rain streaks, fog, cloud shadows and a storm's lightning over the
// fronts the server planned, plus a sky wash. Six draw calls however big the
// storm (and a glow pass round the bolts on the high tier). Lightning lights
// the cloud bellies and flashes the scene's light; a storm over the patch
// dims and cools it. Cozy Patches build nothing. The map's tile marks and
// flags are DOM over the canvas, so they stay readable over a cloud.

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
      // Writes depth, and draws before the other weather (`alphaIndex`), so
      // the shadows, fog and rain behind a cloud stay hidden behind it.
      cloudMat.disableDepthWrite = false;
      // Babylon turns depth writes off in its blended pass unless forced.
      cloudMat.forceDepthWrite = true;
      attachTerrainPlugin(cloudMat, host.clock);
      // One smooth fused shape with a flat belly; its light comes from the
      // cloud plugin (GLSL), since the material itself is unlit.
      const flash: CloudFlash = { value: 0, keeper: null };
      attachCloudShade(cloudMat, flash);
      const cloud = buildCloud(scene);
      cloud.hasVertexAlpha = true;
      cloud.material = cloudMat;
      cloud.alphaIndex = 0;
      // A storm's bank: one wide slab per front, same material and light.
      const bank = buildBank(scene);
      bank.hasVertexAlpha = true;
      bank.material = cloudMat;
      bank.alphaIndex = 0;

      // Each cloud's soft shadow on the tiles, and a storm bank's see-through
      // lower deck: flat discs, their colour per disc.
      const shadowMat = glowMaterial(scene, 'weather-shadow-mat', '#ffffff', true);
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

      // Lightning: a jagged white bolt in a soft halo that flashes under a
      // storm's lower deck (or holds still when motion is off), added onto the
      // clouds behind it so it glows. Same plugin as the rain, GLSL only.
      const boltLook = WEATHER_LOOK.storm.bolts;
      const boltMat = glowMaterial(scene, 'weather-bolt-mat', '#ffffff', true);
      boltMat.alphaMode = Constants.ALPHA_ADD;
      boltMat.backFaceCulling = false;
      // Seen through the clouds, as a flash lights them from inside; its top
      // fades in, so it comes out of the cloud rather than sitting on it.
      boltMat.depthFunction = Constants.ALWAYS;
      const boltPlugin = attachRain(boltMat, host.clock);
      const bolt = buildBolt(scene, boltLook.width, boltLook.haloWidth, boltLook.halo);
      bolt.material = boltMat;
      for (const m of [shadow, fog, rain]) m.alphaIndex = 1;
      bolt.alphaIndex = 2;

      // The high tier's glow round the bolts: drawn with the bolt's own
      // material, so it flashes with them. Made the first time it is wanted.
      let glow: GlowLayer | null = null;
      const setGlow = (on: boolean): void => {
        if (on && !glow) {
          const g = WEATHER_LOOK.storm.glow;
          glow = new GlowLayer('weather-glow', scene, {
            mainTextureRatio: g.ratio,
            blurKernelSize: g.blur,
          });
          glow.intensity = g.intensity;
          glow.addIncludedOnlyMesh(bolt);
          glow.referenceMeshToUseItsOwnMaterial(bolt);
        }
        if (glow) glow.isEnabled = on;
      };

      // A flash lights the cloud bellies (the cloud plugin) and the scene: the
      // sun and the sky light rise with it, and a sky-wide light (made the
      // first time a storm comes) lights the tiles on both tiers. A storm over
      // the patch dims the sun and the sky and leaves a faint cool light: the
      // storm's mood. The sun's and sky's own values are kept, and taken
      // afresh if something else (the night) changes them meanwhile.
      const sun = scene.getLightByName('sun');
      const pulse = WEATHER_LOOK.storm.flash;
      const mood = WEATHER_LOOK.storm.mood;
      let sunBase = sun?.intensity ?? 0;
      let sunSet = Number.NaN;
      let skyBase = scene.environmentIntensity;
      let skySet = Number.NaN;
      let hemi: HemisphericLight | null = null;
      let stormy = false;
      let lit = Number.NaN;
      const light = (now: number, overPatch: boolean): void => {
        if (now === lit && overPatch === stormy) return;
        lit = now;
        stormy = overPatch;
        flash.value = now;
        const dim = overPatch ? 1 : 0;
        if (sun) {
          if (sun.intensity !== sunSet) sunBase = sun.intensity;
          sunSet = sunBase * (1 - (1 - mood.sun) * dim) * (1 + pulse.sun * now);
          sun.intensity = sunSet;
        }
        if (scene.environmentIntensity !== skySet) skyBase = scene.environmentIntensity;
        skySet = skyBase * (1 - (1 - mood.sky) * dim) * (1 + pulse.sky * now);
        scene.environmentIntensity = skySet;
        if (hemi) hemi.intensity = pulse.hemi * now + mood.hemi * dim;
      };
      const makeHemi = (): void => {
        if (hemi) return;
        hemi = new HemisphericLight('weather-flash', new Vector3(0, 1, -0.3), scene);
        hemi.diffuse = new Color3(...pulse.hemiColour);
        hemi.groundColor = Color3.Black();
        hemi.specular = Color3.Black();
        hemi.intensity = 0;
        lit = Number.NaN;
      };

      const layout = placer.layout;
      instanced(cloud, layout.cloudMatrices, layout.cloudColours, 'color');
      cloud.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, layout.cloudDrift, 4, false);
      instanced(bank, layout.bankMatrices, layout.bankColours, 'color');
      bank.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, layout.bankDrift, 4, false);
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
        // My Keeper stands beside my Heart Seed (map-scene.ts places it there).
        const home = store.home;
        if (home) {
          const at = hexToWorld(home, HEX_SIZE);
          flash.keeper = {
            x: at.x + KEEPER_PLACES.map.offset.x,
            y: HOME_LOOK.height + WEATHER_LOOK.clouds.clearing.height,
            z: at.z + KEEPER_PLACES.map.offset.z,
          };
        } else flash.keeper = null;
        const kind = store.kindNow();
        tint.set(kind);
        if (layout.banks > 0) makeHemi();
        light(flash.value, kind === 'storm');
        if (placed || last.mode !== mode) {
          show(cloud, layout.clouds);
          show(bank, layout.banks);
          show(fog, layout.fog);
          show(rain, layout.rain);
          show(shadow, layout.shadows);
          show(bolt, layout.bolts, boltPlugin !== null);
          setGlow(tier === 'high' && bolt.isEnabled());
          for (const m of [cloud, bank, shadow, fog, rain, bolt]) {
            m.thinInstanceBufferUpdated('matrix');
          }
          shadow.thinInstanceBufferUpdated('color');
          bolt.thinInstanceBufferUpdated(RAIN_ATTRIBUTE);
          cloud.thinInstanceBufferUpdated('color');
          cloud.thinInstanceBufferUpdated(DRIFT_ATTRIBUTE);
          bank.thinInstanceBufferUpdated('color');
          bank.thinInstanceBufferUpdated(DRIFT_ATTRIBUTE);
          fog.thinInstanceBufferUpdated(DRIFT_ATTRIBUTE);
          rain.thinInstanceBufferUpdated(RAIN_ATTRIBUTE);
          host.invalidate();
        }
        last = {
          clouds: layout.clouds + layout.banks,
          rain: layout.rain,
          fog: layout.fog,
          mode,
          placed: placer.placed,
        };
      };

      const off = store.onChange(refresh);
      const stopStore = store.start();
      const timer = setInterval(refresh, PLACE_EVERY_MS);
      // The mode can change under us (the slow-device judge): poll it, no
      // allocation. Each frame also follows the lightning's light.
      const watch = scene.onBeforeRenderObservable.add(() => {
        if (host.mode() !== last.mode) refresh();
        light(
          bolt.isEnabled() ? skyFlash(layout.boltAttrs, layout.bolts, host.clock.time) : 0,
          stormy,
        );
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
