import { boot } from './engine/boot.js';
import { createRenderer, parseRendererPreference } from './engine/renderer.js';
import { pickInitialTier } from './engine/quality/tiers.js';
import { mountStage, type Stage } from './engine/stage.js';
import { fetchHealth } from './net/api.js';
import { buildTestScene } from './scenes/test-scene.js';
import { mountAuth } from './ui/auth/auth-overlay.js';
import { mountLobby } from './ui/lobby/lobby-overlay.js';
import { startPwa } from './pwa/pwa.js';
import './styles.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

// Safari still pinch-zooms the page through its proprietary gesture events,
// even with touch-action: none on the canvas.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
  });
}

const params = new URLSearchParams(window.location.search);
// `?quality=` and `?renderer=webgpu` (opt-in, tech spec §6) stand in for the settings screen.
const tier = pickInitialTier(params.get('quality'));
let stage: Stage | null = null;

/** Swaps the canvas for a clean copy (a WebGPU canvas can't become WebGL2). */
function freshCanvas(): HTMLCanvasElement {
  const current = document.querySelector<HTMLCanvasElement>('#game');
  if (!current) throw new Error('missing #game canvas');
  const next = current.cloneNode(false) as HTMLCanvasElement;
  delete next.dataset['ready'];
  delete next.dataset['renderer'];
  current.replaceWith(next);
  return next;
}

/**
 * Shown if no renderer can start at all (no WebGL2, or a restart after GPU
 * loss failed). Plain DOM, since there's nothing to draw the game with.
 */
function showRendererError(err: unknown): void {
  console.error('Could not start the renderer', err);
  if (document.querySelector('.renderer-error')) return;
  const box = document.createElement('div');
  box.className = 'renderer-error';
  box.setAttribute('role', 'alert');
  box.textContent =
    "Oh no, the squishies can't come out to play! Try updating Safari, then open Heartpatch again.";
  document.body.append(box);
}

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas,
  mount: (renderer, target) => mountStage(renderer, target, buildTestScene, tier),
  onStart: (s) => {
    stage = s;
  },
  onError: showRendererError,
}).catch(showRendererError);

const lobby = mountLobby(document.body);
mountAuth(document.body, { onChange: lobby.setUser });
// Offline shell, update prompt, Add to Home Screen guide (issue #26).
if (import.meta.env.PROD) startPwa(document.body);

if (import.meta.env.DEV) {
  const badge = document.createElement('div');
  badge.className = 'dev-status';
  badge.dataset['testid'] = 'dev-status';
  badge.textContent = 'server: …';
  document.body.append(badge);
  fetchHealth()
    .then((health) => {
      badge.textContent = `server: ${health.status} (${health.version})`;
    })
    .catch(() => {
      badge.textContent = 'server: offline';
    });

  const { mountDevOverlay } = await import('./engine/dev-overlay.js');
  mountDevOverlay(() => stage);
  // Read-only hook for the Playwright smoke test; dev builds only.
  window.__heartpatch = {
    renderer: () => stage?.renderer.kind ?? null,
    quality: () => stage?.quality.snapshot ?? null,
    camera: () => stage?.camera.state ?? null,
    draws: () => stage?.draws ?? 0,
    idle: () => stage?.idle ?? false,
    invalidate: () => stage?.invalidate(),
  };
}
