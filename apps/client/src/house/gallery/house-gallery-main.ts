import type { HouseView } from '@heartpatch/shared';
import { boot } from '../../engine/boot.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { isQualityTier, pickInitialTier } from '../../engine/quality/tiers.js';
import { mountStage, type SceneBuilder, type Stage } from '../../engine/stage.js';
import {
  sampleHouse,
  withGift,
  withGrow,
  type HouseSample,
  type SampleGrow,
} from '../house-fixtures.js';
import { createHouseScreen } from '../house-screen.js';
import '../../styles.css';

/**
 * Dev-only house gallery at `/house.html` (a separate Vite page, never part
 * of the production build): the real house screen (#381) over a sample
 * house, with no server, for judging the look and for house-shots.
 * `?level=1` (default) up to the top level, or `top`; `?tier=high|medium|low`
 * pins a tier (the governor off, as on the main page); `?empty=1` leaves every
 * bed empty; `?still=1` skips the entry glide; `?grow=not-yet|ready` fills
 * in Grow the house (Build it! then builds the next level, no server);
 * `?gift=1` puts today's wrapped gift by a resident's bed (`?gift=hearth`:
 * its giver is out, so by the hearth), and Open it! opens it, no server;
 * `?minute=1200` pins the time of day (minutes after midnight: 720 noon,
 * 1080 dusk, 1200 night; the device's clock if left out); `?welcome=1`
 * shows welcome home on every load and keeps its line up; plus `?renderer=webgpu`.
 */

if (!import.meta.env.DEV) throw new Error('The house gallery is dev-only');

const params = new URLSearchParams(window.location.search);
const pinned = params.get('tier');
const pinTier = isQualityTier(pinned);
let tier = pickInitialTier(pinned, params.get('quality'));
const levelParam = params.get('level');
const level = levelParam === 'top' ? 99 : Number(levelParam) || 1;
const residents = params.get('empty') !== '1';
const growParam = params.get('grow');
const grow: SampleGrow = growParam === 'ready' ? 'ready' : 'not-yet';
const giftParam = params.get('gift');
/** Today's gift as `?gift=` asks: by a resident's bed (the top room's, upstairs too), or the hearth. */
const gifted = (s: HouseSample): HouseSample =>
  giftParam === null || giftParam === '0'
    ? s
    : withGift(s, giftParam === 'hearth' ? { away: true } : {});
let sample = gifted(withGrow(sampleHouse(level, residents), grow));
const minuteParam = params.get('minute');
const minute = minuteParam === null ? null : Number(minuteParam);
/** `?minute=`: today on the device's clock at that minute. */
const now = (): Date => {
  const at = new Date();
  if (minute === null || !Number.isFinite(minute)) return at;
  at.setHours(Math.floor(minute / 60) % 24, Math.floor(minute % 60), 0, 0);
  return at;
};
/** Welcome home remembers nothing in the gallery unless `?welcome=1` asks for it every load. */
const welcome = params.get('welcome') === '1';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

let stage: Stage | null = null;
let builder: SceneBuilder = () => ({ bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } });

/** Swaps the scene on the running renderer, as main.ts does. */
function showScene(build: SceneBuilder | null): void {
  builder = build ?? builder;
  if (!stage) return;
  const { renderer } = stage;
  const target = renderer.engine.getRenderingCanvas();
  tier = stage.quality.snapshot.tier;
  stage.dispose();
  stage = null;
  if (target) stage = mountStage(renderer, target, builder, tier, {}, pinTier);
}

const house = createHouseScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  keeper: () => null,
  onOpen: () => undefined,
  onClosed: () => {
    // Back: open it again, so the gallery always shows the house.
    void house.open('gallery', sample);
  },
  onProblem: (message) => {
    console.error(message);
  },
  api: {
    get: (): Promise<HouseView> => Promise.resolve(sample.view),
    // A pretend build: the next level, its own next level not yet within reach.
    build: async (_mapId: string, toLevel: number): Promise<HouseView> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      sample = withGrow(sampleHouse(toLevel, residents), 'not-yet');
      return sample.view;
    },
    // A pretend open: the gift, opened.
    claimGift: async (): Promise<HouseView> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const gift = sample.view.gift;
      sample = { ...sample, view: { ...sample.view, gift: gift && { ...gift, claimed: true } } };
      return sample.view;
    },
  },
  now,
  requestFrame: () => stage?.requestFrame(),
  storage: welcome ? { getItem: () => null, setItem: () => undefined } : null,
  // `?welcome=1` keeps the line up (for house-shots), until the sheet moves.
  ...(welcome && { welcomeLineMs: 0 }),
  // `?still=1`: as reduced motion, the glide cuts straight to the dollhouse.
  ...(params.get('still') === '1' && { reducedMotion: { matches: true } }),
});
house.setUser({ id: '0190a000-0000-7000-8000-00000000aaaa', username: 'Mia' });

window.__heartpatch = {
  renderer: () => stage?.renderer.kind ?? null,
  quality: () => stage?.quality.snapshot ?? null,
  camera: () => stage?.camera.state ?? null,
  draws: () => stage?.draws ?? 0,
  idle: () => stage?.idle ?? false,
  invalidate: () => stage?.invalidate(),
  house: () => house.debug,
};

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
    stage = mountStage(renderer, target, builder, tier, {}, pinTier);
    return {
      dispose: () => {
        stage?.dispose();
        stage = null;
      },
    };
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});
await house.open('gallery', sample);
