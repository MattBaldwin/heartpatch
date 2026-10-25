import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { hexToWorld, type MapView } from '@heartpatch/shared';
import { boot } from '../../engine/boot.js';
import { CAMERA } from '../../engine/config.js';
import { setPerfReports } from '../../engine/perf-report.js';
import { isQualityTier, pickInitialTier } from '../../engine/quality/tiers.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { mountStage, type Stage } from '../../engine/stage.js';
import { NIGHT_LOOK } from '../../hollow/hollow-config.js';
import { HEX_SIZE } from '../map-config.js';
import { maxZoomFor } from '../map-layout.js';
import { MapScene, type MapSceneStats } from '../map-scene.js';
import { testPatch, testWildIsle } from '../test-view.js';
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
const focus = params.get('focus')?.split(',').map(Number) ?? null;
const distance = Number(params.get('dist')) || null;

const view: MapView = patch === 'cozy' ? testPatch() : testWildIsle();

let stage: Stage | null = null;
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
        map = new MapScene(scene, view, { tier, reducedMotion: true });
        map.setNight(night);
        farthest = maxZoomFor(map.bounds, CAMERA.maxDistance);
        const [q, r] = focus ?? [];
        const start =
          q !== undefined && r !== undefined
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
    };
  }
}

window.__islandMap = {
  ready: () => (stage?.draws ?? 0) > 0 && stage?.scene.isReady() === true,
  stats: () => map?.stats ?? null,
  tier: () => stage?.quality.snapshot.tier ?? null,
};
