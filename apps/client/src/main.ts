import { boot } from './engine/boot.js';
import { createRenderer, parseRendererPreference } from './engine/renderer.js';
import { pickInitialTier } from './engine/quality/tiers.js';
import { mountStage, type SceneBuilder, type Stage } from './engine/stage.js';
import { createBattleScreen } from './battle/battle-screen.js';
import { createInventoryScreen } from './inventory/inventory-screen.js';
import { createMapScreen } from './map/map-screen.js';
import { fetchHealth } from './net/api.js';
import { buildTestScene } from './scenes/test-scene.js';
import { mountAuth } from './ui/auth/auth-overlay.js';
import { createKeeperScreen, KEEPER_TEXT } from './ui/keeper/keeper-screen.js';
import { mountLobby } from './ui/lobby/lobby-overlay.js';
import { startPwa } from './pwa/pwa.js';
import { updateHold } from './pwa/update-hold.js';
import { createTutorialScreen } from './tutorial/tutorial-screen.js';
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
/** The quality tier, carried from stage to stage so the governor's last step down isn't lost. */
let tier = pickInitialTier(params.get('quality'));
let stage: Stage | null = null;
/** What the stage draws: the open map, or the test scene. */
let sceneBuilder: SceneBuilder = buildTestScene;
/** What boot() holds on to: always whichever stage is on screen now (showScene swaps it). */
const currentStage = {
  dispose: () => {
    if (!stage) return;
    tier = stage.quality.snapshot.tier;
    stage.dispose();
    stage = null;
  },
};

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

/** A stage went on screen: the tutorial puts Sprout in it while it's open. */
function mounted(next: Stage): Stage {
  tutorial.attachScene(next.scene, next.camera.state.target, () => {
    next.invalidate();
  });
  return next;
}

/**
 * Swaps the scene on the running renderer (tech spec §6: one engine, scenes
 * swapped). Before the renderer starts, or after it failed, this only picks
 * what the next mount draws.
 */
function showScene(build: SceneBuilder | null): void {
  sceneBuilder = build ?? buildTestScene;
  if (!stage) return;
  const { renderer } = stage;
  const target = renderer.engine.getRenderingCanvas();
  currentStage.dispose();
  if (!target) return;
  try {
    stage = mounted(mountStage(renderer, target, sceneBuilder, tier));
  } catch (err) {
    showRendererError(err);
  }
}

// The bag and gathering (#17): a Bag button over a multiplayer map, and the
// gather buttons in its tile panel.
const inventory = createInventoryScreen({ root: document.body, devTools: import.meta.env.DEV });
// Login and the lobby come first, so a renderer that can't start never hides them.
const maps = createMapScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  onClosed: (message) => {
    void battles.setMap(null);
    void inventory.setMap(null);
    lobby.showMessage(message);
  },
  tileActions: inventory.tileActions,
});
// The tutorial (#47) draws its Tutorial Glade with the map screen and sits
// over it; it never blocks the lobby unless the server requires it first
// (decision A).
const tutorial = createTutorialScreen({
  root: document.body,
  glade: {
    open: async (mapId, stillWanted) => {
      // The Glade is Sprout's: no battle or bag button over it (they come to
      // the tutorial with its later steps).
      await battles.setMap(null);
      await inventory.setMap(null);
      await maps.open(mapId);
      // Put away ("Later") while it loaded: the lobby stays.
      if (stillWanted()) lobby.hide();
    },
    close: () => {
      void battles.setMap(null);
      void inventory.setMap(null);
      maps.close();
      lobby.show();
    },
  },
  onDone: (choice) => {
    if (choice === 'create') lobby.showCreate();
    else if (choice === 'join') lobby.showJoin();
  },
  onEntryChange: () => {
    lobby.refreshList();
  },
});
// Battles (#13) own the whole screen: the map and the lobby's button step
// out while one is open, and the map comes back after.
const battles = createBattleScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onOpen: () => {
    maps.close();
    void inventory.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId) => {
    maps
      .open(mapId)
      .then(() => inventory.setMap(mapId))
      .catch((err: unknown) => {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      });
    lobby.hide();
  },
  devTools: import.meta.env.DEV,
  keeper: () => keeper.current,
});
// Picking a Keeper (#42) comes right after signup, before the tutorial and
// the lobby; Settings opens it again to change the Keeper for free.
const keeper = createKeeperScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onReady: (user) => {
    lobby.setUser(user);
    tutorial.setUser(user);
  },
  onEditOpen: () => {
    void battles.setMap(null);
    void inventory.setMap(null);
    maps.close();
    lobby.stepOut();
  },
  onEditClosed: (saved) => {
    if (saved) lobby.showMessage(KEEPER_TEXT.changed);
    else lobby.show();
  },
});
const lobby = mountLobby(document.body, {
  onOpen: async (mapId) => {
    await maps.open(mapId);
    void inventory.setMap(mapId);
    // Not awaited: the lobby shows its button once this resolves, and a
    // battle resumed here (after a refresh) must step it out again after that.
    void battles.setMap(mapId);
  },
  listActions: tutorial.listActions,
  settings: () => [...keeper.settings(), ...tutorial.settings()],
});
mountAuth(document.body, {
  onChange: (user) => {
    battles.setUser(user);
    inventory.setUser(user);
    maps.setUser(user);
    // The lobby and tutorial wait for a Keeper (`onReady` above).
    keeper.setUser(user);
    if (!user) {
      lobby.setUser(null);
      tutorial.setUser(null);
    }
  },
});
// Offline shell, update prompt, Add to Home Screen guide (issue #26).
if (import.meta.env.PROD) startPwa(document.body);

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas,
  mount: (renderer, target) => {
    stage = mounted(mountStage(renderer, target, sceneBuilder, tier));
    return currentStage;
  },
  onError: showRendererError,
}).catch(showRendererError);

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
    map: () => maps.debug,
    tutorial: () => tutorial.debug,
    updatesHeld: () => updateHold.held,
    battle: () => battles.debug,
    keeper: () => keeper.debug,
    inventory: () => inventory.debug,
  };
}
