import { boot } from '../../engine/boot.js';
import { pickInitialTier } from '../../engine/quality/tiers.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { mountStage, type Stage } from '../../engine/stage.js';
import { HouseProtoScene, type HouseProtoRoom } from './house-proto-scene.js';
import '../../styles.css';

/**
 * Dev-only prototype of the Keeper's house interior (#381, owner direction
 * 2026-10-11: an immersive 3D place in the engine) at `/house-proto.html`,
 * a separate Vite page never in the production build. It draws the Snug or
 * the Heart Hall at dusk with residents, the Keeper and the personal touches,
 * for real-engine captures. `?room=snug|hall`, `?tier=high|medium|low`
 * (pinned, governor off, as `?tier=` on the main page), `?pitch=` and
 * `?dist=` for the camera, plus `?renderer=webgpu`.
 */

if (!import.meta.env.DEV) throw new Error('The house prototype is dev-only');

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

const params = new URLSearchParams(window.location.search);
const pinned = params.get('tier');
const tier = pickInitialTier(pinned, params.get('quality'));
const room: HouseProtoRoom = params.get('room') === 'hall' ? 'hall' : 'snug';
const portrait = window.innerHeight > window.innerWidth;
const pitchDefault = room === 'hall' ? (portrait ? 25 : 20) : portrait ? 19 : 24;
const distDefault = room === 'hall' ? (portrait ? 12.5 : 13.5) : portrait ? 7.0 : 8.5;
const focus = {
  x: Number(params.get('x')) || 0,
  z: Number(params.get('z')) || (room === 'hall' ? (portrait ? 1.4 : 0.6) : portrait ? 0.9 : 0.5),
};
const pitch = ((Number(params.get('pitch')) || pitchDefault) * Math.PI) / 180;
const distance = Number(params.get('dist')) || distDefault;
const fov = Number(params.get('fov')) || (portrait ? 0.95 : 0.88);

let stage: Stage | null = null;
let house: HouseProtoScene | null = null;

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
  mount: (renderer, target) =>
    mountStage(
      renderer,
      target,
      (scene) => {
        house = new HouseProtoScene(scene, { room, tier, focus });
        return house.content;
      },
      tier,
      { pitch, startDistance: distance, minDistance: 3, maxDistance: 40, fov },
      pinned !== null,
    ),
  onStart: (s) => {
    stage = s;
    house?.start(s);
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});

declare global {
  interface Window {
    __houseProto?: {
      ready: () => boolean;
      draws: () => number;
      stats: () => unknown;
      quality: () => unknown;
      invalidate: () => void;
    };
  }
}

window.__houseProto = {
  ready: () => (stage?.draws ?? 0) > 0 && (house?.ready ?? false),
  draws: () => stage?.draws ?? 0,
  quality: () => stage?.quality.snapshot ?? null,
  stats: () => house?.stats ?? null,
  invalidate: () => stage?.invalidate(),
};
