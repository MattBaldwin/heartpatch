import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { hexToWorld, type MapView } from '@heartpatch/shared';
import { boot } from '../../engine/boot.js';
import { CAMERA } from '../../engine/config.js';
import { setPerfReports } from '../../engine/perf-report.js';
import { isQualityTier, pickInitialTier } from '../../engine/quality/tiers.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { mountStage, type Stage } from '../../engine/stage.js';
import { NIGHT_LOOK } from '../../hollow/hollow-config.js';
import { CHRISTMAS, HEX_SIZE } from '../map-config.js';
import { maxZoomFor } from '../map-layout.js';
import { MapScene, type MapSceneStats } from '../map-scene.js';
import {
  testPatch,
  testWildIsle,
  withHomeBuildings,
  withPatchTree,
  withTwinkleLights,
} from '../test-view.js';
import { galleryWeather, galleryWeatherKind } from '../../weather/gallery-weather.js';
import {
  createWeatherLayer,
  type WeatherLayer,
  type WeatherStats,
} from '../../weather/weather-layer.js';
import { WeatherStore } from '../../weather/weather-store.js';
import '../../styles.css';

// A dev gallery never signs in: its perf reports would only be refused (401).
setPerfReports(false);

/**
 * Dev-only island map at `/island.html` (a separate Vite page, never part of
 * the production build): the real map scene over a test patch, no server, so
 * Wild Isle (#621 W1-4) can be seen and measured before its generator and
 * gate land. `?patch=` picks the map: `wild` (default, `testWildIsle`, radius
 * 18) or `cozy` (`testPatch`, the busy 4-Keeper Cozy patch). `&night=1`
 * lights it as the map at night (the Hollow layer's `NIGHT_LOOK`);
 * `&focus=q,r` centres a tile; `&dist=` sets the camera's distance (default
 * the game's start); `&far=1` starts at the farthest zoom. Plus the main
 * page's `?tier=` (pinned, governor off), `?quality=` and `?renderer=webgpu`.
 * `&season=christmas` dresses it in snow (#37); with `&snow=0.5` the first
 * snow's fade stops halfway (the clock ticks once to that point of the fade;
 * `&snow=1` is the whole fade, with the snowfall showing).
 * `&lights=N` puts Twinkle Lights (#37 2a) on N of each Keeper's tiles (from
 * their Heart Seed's out; `&lightsAt=land` only out past the home ring;
 * `&built=1` first puts an Ember Den and Training Grounds by each Heart Seed), and
 * `&motion=1` turns reduced motion off so they twinkle, and `&t=` (seconds)
 * moves the terrain clock there once, so two shots show the twinkle move.
 * `&tree=N` plants the Patch Tree (#37 2d) at the post nearest the middle
 * with N ornaments (`&star=1` lights its star); `&focus=tree` centres it.
 * Nothing moves (the terrain clock never ticks), so a shot is the same every time.
 */

if (!import.meta.env.DEV) throw new Error('The island gallery is dev-only');

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

const params = new URLSearchParams(window.location.search);
const pinTier = isQualityTier(params.get('tier'));
const tier = pickInitialTier(params.get('tier'), params.get('quality'));
const patch = params.get('patch') === 'cozy' ? 'cozy' : 'wild';
const night = params.get('night') === '1';
const far = params.get('far') === '1';
const focusParam = params.get('focus');
const focus = focusParam === 'tree' ? null : (focusParam?.split(',').map(Number) ?? null);
const distance = Number(params.get('dist')) || null;
const weatherKind = galleryWeatherKind(params.get('weather'));
const seasons = params.get('season') === 'christmas' ? ['christmas'] : [];
/** A point of the first snow's fade to stop at (0–1, eased), or null for the snow just there. */
const snowAt = params.has('snow')
  ? Math.min(1, Math.max(0, Number(params.get('snow')) || 0))
  : null;

const lightsPerKeeper = Math.max(0, Math.floor(Number(params.get('lights')) || 0));
const motion = params.get('motion') === '1';
const patchView: MapView = patch === 'cozy' ? testPatch() : testWildIsle();
const bare = params.get('built') === '1' ? withHomeBuildings(patchView) : patchView;
const lightsAt = params.get('lightsAt') === 'land' ? 'land' : 'home';
const lit: MapView =
  lightsPerKeeper > 0 ? withTwinkleLights(bare, lightsPerKeeper, lightsAt) : bare;
const view: MapView = params.has('tree')
  ? withPatchTree(
      lit,
      Math.max(0, Math.floor(Number(params.get('tree')) || 0)),
      params.get('star') === '1',
    )
  : lit;
const treePost = view.posts?.find((p) => p.index === view.christmas?.tree?.postIndex) ?? null;

let stage: Stage | null = null;
let weather: WeatherLayer | null = null;
let map: MapScene | null = null;

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas: () => {
    const current = document.querySelector<HTMLCanvasElement>('#game');
    if (!current) throw new Error('missing #game canvas');
    const fresh = current.cloneNode(false) as HTMLCanvasElement;
    current.replaceWith(fresh);
    return fresh;
  },
  mount: (renderer, target) => {
    let farthest: number = CAMERA.maxDistance;
    return mountStage(
      renderer,
      target,
      (scene) => {
        map = new MapScene(scene, view, {
          tier,
          seasons,
          // Mid-fade (#37): ambient time has to run for the fade; it ticks once, below.
          reducedMotion: snowAt === null && !motion,
          snowFade: snowAt !== null,
        });
        map.setNight(night);
        const at = Number(params.get('t'));
        if (motion && Number.isFinite(at) && at > 0) {
          map.tick(0);
          map.tick(at * 1000);
        }
        if (snowAt !== null) {
          // Smoothstep's inverse, so the cover lands on `snowAt`.
          const t = 0.5 - Math.sin(Math.asin(1 - 2 * snowAt) / 3);
          map.tick(0);
          map.tick(t * CHRISTMAS.fadeMs);
        }
        if (weatherKind) {
          // The weather layer under a fixed sky, as map-screen would host it (#621).
          const store: WeatherStore = new WeatherStore({
            now: () => Date.now(),
            me: () => view.members[0]?.user.id ?? null,
            api: {
              get: () =>
                Promise.resolve(
                  galleryWeather(
                    weatherKind,
                    Date.now(),
                    params.get('vane') === '1',
                    store.home ?? undefined,
                  ),
                ),
            },
          });
          const host = map;
          weather = createWeatherLayer({ store, tier: () => stage?.quality.snapshot.tier ?? tier });
          weather.attach(scene, view, {
            clock: host.terrainClock,
            mode: () => host.ambientMode,
            invalidate: () => stage?.invalidate(),
          });
        }
        farthest = maxZoomFor(map.bounds, CAMERA.maxDistance);
        const [q, r] = focus ?? [];
        const start =
          focusParam === 'tree' && treePost
            ? hexToWorld(treePost, HEX_SIZE)
            : q !== undefined && r !== undefined
              ? hexToWorld({ q, r }, HEX_SIZE)
              : map.homeOf(view, view.members[0]?.user.id ?? null);
        return { bounds: map.bounds, start, maxDistance: farthest };
      },
      tier,
      {
        ...(far ? { startDistance: 1e6 } : distance !== null ? { startDistance: distance } : {}),
      },
      pinTier,
    );
  },
  onStart: (s) => {
    stage = s;
    if (night) {
      // As `HollowLayer` dims the map at nightfall: a lavender sky, moonlight.
      const { scene } = s;
      scene.clearColor = Color4.FromHexString(`${NIGHT_LOOK.clear}ff`);
      scene.environmentIntensity *= NIGHT_LOOK.environment;
      const sun = scene.getLightByName('sun');
      if (sun) {
        sun.intensity *= NIGHT_LOOK.sun;
        sun.diffuse = new Color3(...NIGHT_LOOK.moon);
      }
    }
    s.invalidate();
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});

declare global {
  interface Window {
    __islandMap?: {
      /** True once a frame has drawn and every mesh's shaders are ready. */
      ready: () => boolean;
      stats: () => MapSceneStats | null;
      tier: () => string | null;
      /** The weather layer's counts (#621); null without `?weather=`. */
      weather: () => WeatherStats | null;
      /** The terrain clock: it stands still under reduced motion. */
      clock: () => number | null;
    };
  }
}

window.__islandMap = {
  ready: () => (stage?.draws ?? 0) > 0 && stage?.scene.isReady() === true,
  stats: () => map?.stats ?? null,
  tier: () => stage?.quality.snapshot.tier ?? null,
  weather: () => weather?.stats() ?? null,
  clock: () => map?.terrainClock.time ?? null,
};
