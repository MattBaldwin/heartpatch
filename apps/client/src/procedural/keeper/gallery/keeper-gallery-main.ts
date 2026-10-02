import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  defaultKeeperConfig,
  KEEPER_DATA,
  WARDROBE_SLOTS,
  type KeeperConfig,
  type WardrobeSlot,
} from '@heartpatch/shared';
import { boot } from '../../../engine/boot.js';
import type { QualityTier } from '../../../engine/config.js';
import { pickInitialTier } from '../../../engine/quality/tiers.js';
import { createRenderer, parseRendererPreference } from '../../../engine/renderer.js';
import { mountStage, type Stage } from '../../../engine/stage.js';
import { el } from '../../../ui/dom.js';
import type { SquishMove } from '../../config.js';
import { lodFor, type SquishyView } from '../../motion.js';
import { KEEPER_PLACES } from '../keeper-config.js';
import type { KeeperField, KeeperHandle } from '../keeper-field.js';
import { PLACEHOLDER_ITEMS, type KeeperItem } from '../keeper-items.js';
import { keeperHash, keeperParams } from '../keeper-params.js';
import { buildKeeperGalleryScene } from './keeper-gallery-scene.js';
import '../../../styles.css';
import '../../gallery/gallery.css';

/**
 * Dev-only Keeper gallery at `/keepers.html` (a separate Vite page, never
 * part of the production build). Shows every Keeper base; tap the buttons to
 * cheer.
 *
 * Query flags: `?items=all` (a stand-in item in every slot but costume),
 * `?items=costume` or `?items=hat,shoes`, `?count=40` (stress test, colours
 * vary), `?base=wren`, `?view=closeup`, `?yaw=180` (turn them round), plus
 * the main page's `?quality=` and `?renderer=webgpu`.
 */

if (!import.meta.env.DEV) throw new Error('The Keeper gallery is dev-only');

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
  });
}

const params = new URLSearchParams(window.location.search);
const tier = pickInitialTier(params.get('quality'));
const view: SquishyView = params.get('view') === 'closeup' ? 'closeUp' : 'map';
const data = KEEPER_DATA;

const baseParam = params.get('base');
const bases = baseParam ? data.bases.filter((b) => b.id === baseParam) : data.bases;
const requested = Number(params.get('count'));
const count =
  Number.isInteger(requested) && requested > 0
    ? Math.min(requested, 200)
    : view === 'closeUp'
      ? 1
      : bases.length;
/** Base defaults first; past the end, colours cycle so repeats look different. */
const configs: KeeperConfig[] = Array.from({ length: count }, (_, i) => {
  const base = bases[i % bases.length];
  if (!base) throw new Error('no Keeper bases');
  if (i < bases.length) return defaultKeeperConfig(base);
  const pick = (rows: readonly { id: string }[], k: number) =>
    rows[(i * k) % rows.length]?.id ?? '';
  return {
    base: base.id,
    hairColor: pick(data.hairColors, 3),
    eyeColor: pick(data.eyeColors, 5),
    outfit: pick(data.outfits, 7),
  };
});

function itemsFor(flag: string | null): KeeperItem[] {
  if (!flag || flag === 'none') return [];
  if (flag === 'all') return PLACEHOLDER_ITEMS.filter((item) => item.slot !== 'costume');
  const slots = new Set(flag.split(','));
  return PLACEHOLDER_ITEMS.filter((item) => slots.has(item.slot));
}
const items = itemsFor(params.get('items'));
// Degrees; 180 shows the back (hair, backpacks).
const yaw = (Number(params.get('yaw')) || 0) * (Math.PI / 180);

let stage: Stage | null = null;
let field: KeeperField | null = null;
let shownTier: QualityTier | null = null;
let animating = false;

function freshCanvas(): HTMLCanvasElement {
  const current = document.querySelector<HTMLCanvasElement>('#game');
  if (!current) throw new Error('missing #game canvas');
  const next = current.cloneNode(false) as HTMLCanvasElement;
  delete next.dataset['ready'];
  delete next.dataset['renderer'];
  current.replaceWith(next);
  return next;
}

const handles = (): KeeperHandle[] => field?.handles ?? [];

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas,
  mount: (renderer, target) =>
    mountStage(
      renderer,
      target,
      (scene) => {
        field?.dispose();
        const built = buildKeeperGalleryScene(scene, data, {
          configs,
          items,
          lod: lodFor(view, tier),
          scale: view === 'closeUp' ? KEEPER_PLACES.preview.scale : 1,
          yaw,
          lean: view === 'closeUp' ? KEEPER_PLACES.preview.lean : KEEPER_PLACES.map.lean,
        });
        field = built.field;
        return built.content;
      },
      tier,
    ),
  onStart: (s) => {
    stage = s;
    shownTier = null;
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});

// Drives cheers: the stage only draws on demand, so keep it drawing while a
// Keeper moves, and follow the quality governor's tier with the LOD.
function frame(): void {
  const s = stage;
  if (s && field) {
    const t = s.quality.snapshot.tier;
    if (t !== shownTier) {
      shownTier = t;
      field.setLod(lodFor(view, t));
      s.invalidate();
    }
    animating = field.update(performance.now());
    if (animating) s.invalidate();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function playAll(move: SquishMove): void {
  const now = performance.now();
  for (const h of handles()) field?.play(h, move, now);
  stage?.invalidate();
}

const moves: { move: SquishMove; label: string }[] = [
  { move: 'bounce', label: 'Cheer!' },
  { move: 'jiggle', label: 'Wiggle' },
];
const itemsButton = el('button', { type: 'button' }, items.length > 0 ? 'No items' : 'Items');
// Re-dressing reloads with the other `?items=` (the gallery isn't hot code).
itemsButton.addEventListener('click', () => {
  const next = new URLSearchParams(window.location.search);
  if (items.length > 0) next.delete('items');
  else next.set('items', 'all');
  window.location.search = next.toString();
});
const panel = el(
  'div',
  { class: 'gallery-panel', 'data-testid': 'keeper-gallery-panel' },
  el('span', { class: 'gallery-title' }, String(count)),
  ...moves.map(({ move, label }) => {
    const button = el('button', { type: 'button' }, label);
    button.addEventListener('click', () => {
      playAll(move);
    });
    return button;
  }),
  itemsButton,
);
document.body.append(panel);

const { mountDevOverlay } = await import('../../../engine/dev-overlay.js');
mountDevOverlay(() => stage);

window.__heartpatch = {
  renderer: () => stage?.renderer.kind ?? null,
  quality: () => stage?.quality.snapshot ?? null,
  camera: () => stage?.camera.state ?? null,
  draws: () => stage?.draws ?? 0,
  idle: () => stage?.idle ?? false,
  invalidate: () => stage?.invalidate(),
};

/** Which slots have pieces on Keeper `i`. */
function slotsWorn(i: number): WardrobeSlot[] {
  const h = handles()[i];
  if (!h) return [];
  const layers = new Set<string>(h.params.pieces.map((p) => p.layer));
  return WARDROBE_SLOTS.filter((slot) => layers.has(slot));
}

window.__heartpatchKeepers = {
  stats: () => (stage && stage.draws > 0 ? (field?.stats ?? null) : null),
  shown: () => handles().map((h) => h.params.config.base),
  registryBases: () => data.bases.map((b) => b.id),
  slotsWorn,
  missing: () => [...new Set(handles().flatMap((h) => h.params.missing))],
  keeperHash: (config, slots) =>
    keeperHash(
      keeperParams(
        config,
        data,
        PLACEHOLDER_ITEMS.filter((item) => slots.includes(item.slot)),
      ),
    ),
  hashOf: (i) => {
    const h = handles()[i];
    return h ? keeperHash(h.params) : null;
  },
  screenPoint: (i) => {
    const h = handles()[i];
    const centre = h ? field?.centre(h) : null;
    const s = stage;
    if (!centre || !s) return null;
    const engine = s.scene.getEngine();
    const viewport = s.camera.camera.viewport.toGlobal(
      engine.getRenderWidth(),
      engine.getRenderHeight(),
    );
    const p = Vector3.Project(centre, Matrix.Identity(), s.scene.getTransformMatrix(), viewport);
    const css = engine.getHardwareScalingLevel();
    return { x: p.x * css, y: p.y * css };
  },
  playing: (i) => {
    const h = handles()[i];
    return h ? (field?.isPlaying(h, performance.now()) ?? false) : false;
  },
  play: playAll,
  animating: () => animating,
};
