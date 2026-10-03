import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { boot } from '../../engine/boot.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { pickInitialTier } from '../../engine/quality/tiers.js';
import { mountStage, type Stage } from '../../engine/stage.js';
import { el } from '../../ui/dom.js';
import type { QualityTier } from '../../engine/config.js';
import type { SquishMove } from '../config.js';
import { lodFor, type SquishyView } from '../motion.js';
import { paramsHash, squishyParams } from '../params.js';
import type { SquishyField, SquishyHandle } from '../squishy-field.js';
import { buildGalleryScene } from './gallery-scene.js';
import { galleryLooks } from './showcase.js';
import '../../styles.css';
import './gallery.css';

/**
 * Dev-only squishy gallery at `/gallery.html` (a separate Vite page, never
 * part of the production build). Shows every species and every registry
 * body and part; tap a squishy to jiggle it.
 *
 * Query flags: `?count=50` (stress test), `?look=showcase-3`, `?view=closeup`,
 * `?yaw=180` (turn them round), `?still` (no breathing, so the scene goes
 * idle), `?shadow` (the rescue guardians' shadow look), plus the main page's
 * `?quality=` and `?renderer=webgpu`.
 */

if (!import.meta.env.DEV) throw new Error('The squishy gallery is dev-only');

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
const registry = visualRegistry(GAME_DATA);
const allLooks = galleryLooks(GAME_DATA.species, GAME_DATA.bodies, GAME_DATA.parts);
const lookParam = params.get('look');
const looks = lookParam ? allLooks.filter((l) => l.id === lookParam) : allLooks;
const requested = Number(params.get('count'));
const count =
  Number.isInteger(requested) && requested > 0
    ? Math.min(requested, 200)
    : view === 'closeUp'
      ? 1
      : looks.length;
const breathing = !params.has('still');
// The rescue guardians' shadow look (owner decision 7), to judge by eye.
const shadow = params.has('shadow');
// Degrees; 180 shows the back (tails, wings).
const yaw = (Number(params.get('yaw')) || 0) * (Math.PI / 180);

let stage: Stage | null = null;
let field: SquishyField | null = null;
let shownTier: QualityTier | null = null;
let lastTapped: number | null = null;
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

const handles = (): SquishyHandle[] => field?.handles ?? [];

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
        const built = buildGalleryScene(scene, registry, {
          looks,
          count,
          lod: lodFor(view, tier),
          breathing,
          scale: view === 'closeUp' ? 5 : 1,
          yaw,
          shadow,
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

// Drives motion: the stage only draws on demand, so keep it drawing while
// squishies move, and follow the quality governor's tier with the LOD.
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

// Tap to jiggle. MapCamera owns drags and pinches; a short, still touch is a tap.
let down: { x: number; y: number; at: number; id: number } | null = null;
document.addEventListener('pointerdown', (e) => {
  if (!(e.target instanceof HTMLCanvasElement)) return;
  down = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId };
});
document.addEventListener('pointerup', (e) => {
  const start = down;
  down = null;
  if (!start || start.id !== e.pointerId || !field || !(e.target instanceof HTMLCanvasElement))
    return;
  const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
  if (moved > 10 || performance.now() - start.at > 400) return; // TUNE
  const rect = e.target.getBoundingClientRect();
  const hit = field.pick(e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;
  lastTapped = handles().indexOf(hit);
  field.play(hit, 'jiggle', performance.now());
  stage?.invalidate();
});

const moves: { move: SquishMove; label: string }[] = [
  { move: 'jiggle', label: 'Jiggle' },
  { move: 'wobble', label: 'Wobble' },
  { move: 'bounce', label: 'Bounce!' },
];
const panel = el(
  'div',
  { class: 'gallery-panel', 'data-testid': 'gallery-panel' },
  el('span', { class: 'gallery-title' }, `Squishy gallery · ${count}`),
  ...moves.map(({ move, label }) => {
    const button = el('button', { type: 'button' }, label);
    button.addEventListener('click', () => {
      playAll(move);
    });
    return button;
  }),
);
document.body.append(panel);

const { mountDevOverlay } = await import('../../engine/dev-overlay.js');
mountDevOverlay(() => stage);

window.__heartpatch = {
  renderer: () => stage?.renderer.kind ?? null,
  quality: () => stage?.quality.snapshot ?? null,
  camera: () => stage?.camera.state ?? null,
  draws: () => stage?.draws ?? 0,
  idle: () => stage?.idle ?? false,
  invalidate: () => stage?.invalidate(),
};

window.__heartpatchGallery = {
  stats: () => (stage && stage.draws > 0 ? (field?.stats ?? null) : null),
  shown: () => handles().map((h) => h.params.speciesId),
  coverage: () => {
    const shown = handles().map((h) => h.params);
    return {
      bodies: [...new Set(shown.map((p) => p.body.id))],
      parts: [...new Set(shown.flatMap((p) => p.parts.map((part) => part.id)))].filter((id) =>
        registry.parts.has(id),
      ),
      registryBodies: [...registry.bodies.keys()],
      registryParts: [...registry.parts.keys()],
    };
  },
  missing: () => [...new Set(handles().flatMap((h) => h.params.missing))],
  paramsHash: (species, instanceId) => paramsHash(squishyParams(species, instanceId, registry)),
  squishyHash: (i) => {
    const h = handles()[i];
    return h ? paramsHash(h.params) : null;
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
  lastTapped: () => lastTapped,
  playing: (i) => {
    const h = handles()[i];
    return h ? (field?.isPlaying(h, performance.now()) ?? false) : false;
  },
  play: playAll,
  animating: () => animating,
};
