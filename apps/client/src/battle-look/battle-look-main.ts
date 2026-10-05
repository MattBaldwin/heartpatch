import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { boot } from '../engine/boot.js';
import { createRenderer, parseRendererPreference } from '../engine/renderer.js';
import { pickInitialTier } from '../engine/quality/tiers.js';
import { mountStage, type Stage } from '../engine/stage.js';
import { lodFor } from '../procedural/motion.js';
import { directionOf } from './directions.js';
import { mountLookHud } from './look-hud.js';
import { LookScene, type LookStats } from './look-scene.js';
import { sequenceLength, shotOf } from './shots.js';
import '../styles.css';

/**
 * Dev-only battle look prototypes at `/battle-look.html` (a separate Vite
 * page, never part of the production build). Query flags:
 * `?dir=A|B|C` the direction, `?shot=<id>` the moment (shots.ts),
 * `?t=<ms>` overrides the frozen time, `?play` runs the sequence on a loop,
 * `?reduced=1` the reduced-motion variant, plus `?quality=` and `?renderer=`.
 */

if (!import.meta.env.DEV) throw new Error('The battle look prototypes are dev-only');

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

const params = new URLSearchParams(window.location.search);
const tier = pickInitialTier(params.get('quality'));
const direction = directionOf(params.get('dir'));
const shot = shotOf(params.get('shot'));
const frozenT = params.has('t') ? Number(params.get('t')) : shot.t;
const play = params.has('play');
const reduced = params.has('reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const registry = visualRegistry(GAME_DATA);
document.title = `Battle look · ${direction.name} · ${shot.label}`;

const hud = mountLookHud(document.body, direction);

let stage: Stage | null = null;
let look: LookScene | null = null;
let readyFrames = 0;
const start = performance.now();

function freshCanvas(): HTMLCanvasElement {
  const current = document.querySelector<HTMLCanvasElement>('#game');
  if (!current) throw new Error('missing #game canvas');
  const next = current.cloneNode(false) as HTMLCanvasElement;
  delete next.dataset['ready'];
  delete next.dataset['renderer'];
  current.replaceWith(next);
  return next;
}

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas,
  mount: (renderer, target) =>
    mountStage(
      renderer,
      target,
      (scene) => {
        look?.dispose();
        look = new LookScene(scene, {
          shot,
          direction,
          registry,
          lod: lodFor('closeUp', tier),
          reduced,
          safe: () => hud.safe(),
        });
        const { player, foe } = look.fighters();
        hud.setPills(
          { name: player.name, level: shot.player.level, element: player.element, feeling: player.feeling, energy: shot.player.energy },
          { name: foe.name, level: shot.foe.level, element: foe.element, feeling: foe.feeling, energy: shot.sequence === 'ko' && shot.actor === 'foe' ? 0 : shot.foe.energy },
        );
        const moves = player.moves
          .map((id) => GAME_DATA.moves.find((m) => m.id === id)?.name ?? id)
          .slice(0, 4);
        while (moves.length < 4) moves.push('Rest');
        hud.setSheet(shot.sheet, shot.caption, moves);
        if (shot.sequence === 'attack' && shot.t >= 640) {
          hud.callout(shot.actor === 'player' ? 'theirs' : 'mine', shot.element === 'water' ? 'Splish!' : 'Super cozy!');
        }
        look.setTime(frozenT);
        return look.content;
      },
      tier,
    ),
  onStart: (s) => {
    stage = s;
    readyFrames = 0;
    s.scene.onAfterRenderObservable.add(() => {
      if (s.scene.isReady(true)) readyFrames++;
    });
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});

function frame(): void {
  const s = stage;
  if (s && look) {
    if (play) {
      const len = sequenceLength(shot.sequence);
      look.setTime((performance.now() - start) % len);
      s.invalidate();
    } else if (readyFrames < 6) {
      // Frozen: draw a few frames after everything is ready, so the frame left
      // on screen was drawn with every shader and the shadow blur in place.
      look.setTime(frozenT);
      s.invalidate();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const { mountDevOverlay } = await import('../engine/dev-overlay.js');
if (params.has('stats')) mountDevOverlay(() => stage);

declare global {
  interface Window {
    __heartpatchLook?: {
      settled(): boolean;
      stats(): (LookStats & { direction: string; shot: string; reduced: boolean }) | null;
      debug(): unknown;
    };
  }
}

window.__heartpatch = {
  renderer: () => stage?.renderer.kind ?? null,
  quality: () => stage?.quality.snapshot ?? null,
  camera: () => stage?.camera.state ?? null,
  draws: () => stage?.draws ?? 0,
  idle: () => stage?.idle ?? false,
  invalidate: () => stage?.invalidate(),
};

window.__heartpatchLook = {
  settled: () => !play && stage !== null && readyFrames >= 6 && stage.idle,
  stats: () => (look ? { ...look.stats, direction: direction.id, shot: shot.id, reduced } : null),
  debug: () => look?.debugFacing() ?? null,
};
