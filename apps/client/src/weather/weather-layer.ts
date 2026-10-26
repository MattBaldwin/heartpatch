import { Constants } from '@babylonjs/core/Engines/constants';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
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
import { createCloudDiscs, underCloud } from './cloud-cover.js';
import { attachCloudShade, type CloudFlash } from './cloud-plugin.js';
import { attachRain, RAIN_ATTRIBUTE } from './rain-plugin.js';
import { buildBolt, buildCloud } from './weather-clouds.js';
import { WEATHER_LOOK } from './weather-config.js';
import { skyFlash } from './weather-flash.js';
import { FULL_CLOUDS, WEATHER_CAPS } from './weather-layout.js';
import { WeatherPlacer, PLACE_EVERY_MS } from './weather-placer.js';
import type { WeatherStore } from './weather-store.js';
import { createWeatherTint } from './weather-tint.js';

// The Wild Isle weather you can see (#621 W1-9): instanced clouds, rain
// streaks, fog, cloud shadows and a storm's lightning over the fronts the
// server planned, plus a sky wash. Five draw calls however big the storm (and
// a glow pass round the bolts on the high tier). Lightning lights the cloud
// bellies and pulses the scene's light. Cozy Patches build nothing.

export interface WeatherLayerOptions {
  readonly store: WeatherStore;
  readonly tier: () => QualityTier;
  readonly root?: HTMLElement;
}

/** The map's tile badges (DOM, not tappable) a cloud hides while it is over them. */
const COVERED_BADGES = ['dark-moon', 'tile-mark'];
/** How often, at most, badges under the clouds are checked again (ms). // TUNE: */
const COVER_EVERY_MS = 100;
/** Share of a cloud's scaled half-width that hides what is behind it (the shape has no soft edge, so all of it). // TUNE: */
const COVER_BODY = 1;

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
      const flash: CloudFlash = { value: 0 };
      attachCloudShade(cloudMat, flash);
      const cloud = buildCloud(scene);
      cloud.hasVertexAlpha = true;
      cloud.material = cloudMat;
      cloud.alphaIndex = 0;

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
      // sun and the sky light rise with it. Their own value is kept, and
      // taken afresh if something else (the night) changes it meanwhile.
      const sun = scene.getLightByName('sun');
      const pulse = WEATHER_LOOK.storm.flash;
      let sunBase = sun?.intensity ?? 0;
      let sunSet = Number.NaN;
      let skyBase = scene.environmentIntensity;
      let skySet = Number.NaN;
      const light = (lit: number): void => {
        if (lit === flash.value) return;
        flash.value = lit;
        if (sun) {
          if (sun.intensity !== sunSet) sunBase = sun.intensity;
          sunSet = sunBase * (1 + pulse.sun * lit);
          sun.intensity = sunSet;
        }
        if (scene.environmentIntensity !== skySet) skyBase = scene.environmentIntensity;
        skySet = skyBase * (1 + pulse.sky * lit);
        scene.environmentIntensity = skySet;
      };

      // Badges over the tiles (DOM) that a cloud's body is over hide
      // (cloud-cover.ts). Checked when the camera or the clouds move, at most
      // every `COVER_EVERY_MS`, into fixed buffers.
      const cover = createCloudDiscs(WEATHER_CAPS.clouds);
      // Live lists, made once: the 🌙 over dark land and the map's tile marks.
      const covered = COVERED_BADGES.map((name) => document.getElementsByClassName(name));
      const viewport = new Viewport(0, 0, 1, 1);
      const centre = new Vector3();
      const edge = new Vector3();
      const onScreen = new Vector3();
      const offScreen = new Vector3();
      let coverFlag = -1;
      let coverDirty = true;
      let coverAt = 0;
      let coverLater = 0;
      // A check skipped for being too soon runs once the wait is up, so the
      // last place the camera came to rest is always checked.
      // A check is followed by one more a moment later: the badges are
      // placed after the frame (by their own layer), maybe after this check.
      let trailing = false;
      const coverAgain = (): void => {
        coverLater = 0;
        coverDirty = true;
        trailing = true;
        coverBadges();
        trailing = false;
      };
      const coverBadges = (): void => {
        const camera = scene.activeCamera;
        const canvas = scene.getEngine().getRenderingCanvas();
        if (!camera || !canvas) return;
        const transform = camera.getTransformationMatrix();
        if (!coverDirty && transform.updateFlag === coverFlag) return;
        const now = performance.now();
        if (now - coverAt < COVER_EVERY_MS) {
          if (!coverLater) coverLater = window.setTimeout(coverAgain, COVER_EVERY_MS);
          return;
        }
        coverAt = now;
        coverDirty = false;
        if (!trailing && !coverLater) coverLater = window.setTimeout(coverAgain, COVER_EVERY_MS);
        coverFlag = transform.updateFlag;
        cover.count = 0;
        if (cloud.isEnabled()) {
          const box = canvas.getBoundingClientRect();
          camera.viewport.toGlobalToRef(box.width, box.height, viewport);
          const m = layout.cloudMatrices;
          for (let i = 0; i < layout.clouds; i++) {
            const o = i * 16;
            const r = (m[o] ?? 0) * COVER_BODY;
            centre.set(m[o + 12] ?? 0, m[o + 13] ?? 0, m[o + 14] ?? 0);
            Vector3.ProjectToRef(centre, Matrix.IdentityReadOnly, transform, viewport, onScreen);
            edge.set(centre.x + r, centre.y, centre.z);
            Vector3.ProjectToRef(edge, Matrix.IdentityReadOnly, transform, viewport, offScreen);
            if (onScreen.z < 0 || onScreen.z > 1) continue;
            const d = cover.count * 3;
            cover.discs[d] = box.left + onScreen.x;
            cover.discs[d + 1] = box.top + onScreen.y;
            cover.discs[d + 2] = Math.hypot(offScreen.x - onScreen.x, offScreen.y - onScreen.y);
            cover.count++;
          }
        }
        for (const badges of covered) {
          for (let i = 0; i < badges.length; i++) {
            const badge = badges[i];
            if (!badge) continue;
            let hide = false;
            if (cover.count > 0 && badge instanceof HTMLElement && !badge.hidden) {
              const b = badge.getBoundingClientRect();
              hide = underCloud(cover, b.left + b.width / 2, b.top + b.height / 2);
            }
            badge.classList.toggle('weather-under-cloud', hide);
          }
        }
      };

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
        // Clouds drift and badges come and go without a frame being drawn (a
        // still map renders only on change): check them here too.
        coverDirty = true;
        coverBadges();
        if (placed || last.mode !== mode) {
          show(cloud, layout.clouds);
          show(fog, layout.fog);
          show(rain, layout.rain);
          show(shadow, layout.clouds);
          show(bolt, layout.bolts, boltPlugin !== null);
          setGlow(tier === 'high' && bolt.isEnabled());
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
      // The mode can change under us (the slow-device judge): poll it, no
      // allocation. Each frame also follows the lightning's light.
      const watch = scene.onBeforeRenderObservable.add(() => {
        if (host.mode() !== last.mode) refresh();
        light(bolt.isEnabled() ? skyFlash(layout.boltAttrs, layout.bolts, host.clock.time) : 0);
      });
      const afterRender = scene.onAfterRenderObservable.add(coverBadges);
      scene.onDisposeObservable.add(() => {
        clearInterval(timer);
        clearTimeout(coverLater);
        stopStore();
        off();
        scene.onBeforeRenderObservable.remove(watch);
        scene.onAfterRenderObservable.remove(afterRender);
        for (const badge of document.querySelectorAll('.weather-under-cloud'))
          badge.classList.remove('weather-under-cloud');
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
