import { createAudio } from './audio/audio.js';
import { battleCue, careCue, touchCue } from './audio/cues.js';
import { boot } from './engine/boot.js';
import { createRenderer, parseRendererPreference } from './engine/renderer.js';
import { pickInitialTier } from './engine/quality/tiers.js';
import { mountStage, type SceneBuilder, type Stage } from './engine/stage.js';
import { createBattleScreen } from './battle/battle-screen.js';
import { createHollowScreen } from './hollow/hollow-screen.js';
import { HollowLayer } from './hollow/hollow-layer.js';
import { createHomeScreen } from './home/home-screen.js';
import { createInventoryScreen } from './inventory/inventory-screen.js';
import { createCatalogScreen } from './catalog/catalog-screen.js';
import { createCareSheet } from './care/care-sheet.js';
import { createJobs } from './squishies/jobs/index.js';
import { createChatScreen } from './chat/chat-screen.js';
import { createCloseUpScreen, type CloseUpFrom } from './close-up/close-up-screen.js';
import { combineTileActions } from './map/tile-actions.js';
import { createMapScreen } from './map/map-screen.js';
import { fetchHealth } from './net/api.js';
import { buildTestScene } from './scenes/test-scene.js';
import { createCinematicScreen } from './cinematics/cinematic-screen.js';
import { mountAuth } from './ui/auth/auth-overlay.js';
import { createLorebook } from './lore/lorebook.js';
import { createMilestoneCelebration } from './milestones/milestone-celebration.js';
import { createKeeperScreen, KEEPER_TEXT } from './ui/keeper/keeper-screen.js';
import { mountLobby } from './ui/lobby/lobby-overlay.js';
import { boutiqueApi } from './ui/boutique/boutique-api.js';
import { createCoinCounter } from './ui/coins/coin-counter.js';
import { createWardrobeScreen } from './ui/wardrobe/wardrobe-screen.js';
import { startPwa } from './pwa/pwa.js';
import { updateHold } from './pwa/update-hold.js';
import { createRaidReport, withRaidReport } from './raids/raid-report.js';
import { createStarterScreen } from './starters/starter-screen.js';
import { createTerritoryScreen } from './territory/territory-screen.js';
import { createTutorialScreen } from './tutorial/tutorial-screen.js';
import type { PublicUser } from '@heartpatch/shared';
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

/** The Tutorial Glade on screen while the tutorial runs (#47, #24), else null. */
let glade: string | null = null;
/** Quick messages are for patches: none on the Glade (the server refuses them there). */
const chatFor = (mapId: string): string | null => (mapId === glade ? null : mapId);

// Sound (#25): silent until the first tap, which unlocks it (iOS) and loads
// the engine. Screens report moments; the audio module picks the sound.
const audio = createAudio();

// The bag and gathering (#17): a Bag button over a multiplayer map, and the
// gather buttons in its tile panel.
const inventory = createInventoryScreen({ root: document.body, devTools: import.meta.env.DEV });
// Care (#19): one squishy's sheet (feed, pet, play, level and mood), opened
// from home base and the catalog; it celebrates an evolution the first time
// the player is back from the battle that caused it, or opens their home.
const care = createCareSheet({
  root: document.body,
  onSquish: (kind) => {
    audio.cue(careCue(kind));
  },
  onCloseUp: (mapId, squishyId) => {
    void closeUp.open(mapId, squishyId, homeOpen() ? 'home' : 'map');
  },
});
// Squishy jobs (owner decisions 2026-10-04): the job board and team picker
// sheets. Temporary entry points the trays will move: home's "Jobs & team",
// the tile panel's "Send a gatherer", and Team / Jobs by the battle entry.
const jobs = createJobs({ root: document.body, isGlade: (mapId) => mapId === glade });
/** Home base is on screen (the close-up returns there, #20). */
const homeOpen = () => home.debug?.open ?? false;
// The close-up view (#20): a squishy face to face, with gestures for care.
// Opened by tapping a squishy at home base, or "Up close" on its care sheet
// (from home base, or the catalog over the map). Like home base, it owns the
// screen while open; Back swoops out and returns where the player was.
const closeUp = createCloseUpScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  snapshot: () => {
    if (!stage) return null;
    // Draw a whole frame now, so the canvas holds it to read in this same
    // task (WebGPU only submits the frame at endFrame).
    const { engine } = stage.renderer;
    engine.beginFrame();
    stage.scene.render();
    engine.endFrame();
    return engine.getRenderingCanvas();
  },
  onOpen: () => {
    maps.close();
    catalog.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void chat.setMap(null);
    void battles.setMap(null);
    home.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId: string, from: CloseUpFrom) => {
    if (from === 'home') {
      home.setMap(mapId);
      // Home base celebrates an evolution as it opens (#19).
      void home.open();
      return;
    }
    maps
      .open(mapId)
      .then(() => {
        void inventory.setMap(mapId);
        void territory.setMap(mapId);
        void hollow.setMap(mapId);
        void chat.setMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
        void care.celebrateNews(mapId);
      })
      .catch((err: unknown) => {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      });
    lobby.hide();
  },
  onProblem: (message) => {
    lobby.showMessage(message);
  },
  onTouch: (kind) => {
    audio.cue(touchCue(kind));
  },
});
/** #16's raid report is open: the Hollow's morning report waits its turn (#21). */
let raidReportOpen = false;
// Territory (#15): Claim, Challenge and guards in the tile panel. A tile
// battle opens the battle screen, unless another screen sits over the map.
// The raid report (#16) rides along with territory onto every map: challenges
// on my land while I was away, my defense style, and replays in the battle screen.
const raidReport = createRaidReport({
  root: document.body,
  watch: (replay) => {
    if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen) {
      battles.watch(replay.start, replay.end);
    }
  },
  onOpenChange: (open) => {
    raidReportOpen = open;
    hollow.otherReportChanged();
  },
});
const territory = withRaidReport(
  createTerritoryScreen({
    openBattle: (battle) => {
      if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen) battles.open(battle);
    },
  }),
  raidReport,
);
// The Hollow Man (#21): the night on the map, his visit when night falls,
// the morning report, and rescues (a rescue battle opens the battle screen).
const hollowLayer = new HollowLayer({ invalidate: () => stage?.invalidate() });
const hollow = createHollowScreen({
  root: document.body,
  // The night loop plays while it's night on the map, and his visit hushes it.
  layer: {
    setNight: (night) => {
      hollowLayer.setNight(night);
      maps.setNight(night);
      audio.setNight(night);
    },
    visit: (done) => {
      const visiting = hollowLayer.visit(done);
      if (visiting) audio.cue('nightfall');
      return visiting;
    },
    get debug() {
      return hollowLayer.debug;
    },
  },
  otherReportOpen: () => raidReportOpen,
  openBattle: (battle) => {
    if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen) battles.open(battle);
  },
  devTools: import.meta.env.DEV,
});
// Quick messages (#23): a Chat button over a multiplayer map, with presets,
// emoji and squishy stickers, and little bubbles when someone says something.
const chat = createChatScreen({ root: document.body });
// The home base (#18): a Home button over a multiplayer map opens the
// player's home tiles up close, where they build, fuel the fire and house
// squishies. Like battles, it owns the screen while open.
const home = createHomeScreen({
  root: document.body,
  onProblem: (message) => {
    lobby.showMessage(message);
  },
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  keeper: () => keeper.current,
  keeperWearing: () => wardrobe.wearing,
  onJobs: (mapId) => {
    void jobs.openJobBoard(mapId);
  },
  showJobs: (mapId) => mapId !== glade,
  onOpen: (mapId) => {
    maps.close();
    catalog.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void chat.setMap(null);
    void battles.setMap(null);
    lobby.stepOut();
    void care.celebrateNews(mapId);
  },
  onCare: (mapId, squishyId) => {
    void care.open(mapId, squishyId);
  },
  onCloseUp: (mapId, squishyId) => {
    audio.cue('squeak');
    void closeUp.open(mapId, squishyId, 'home');
  },
  onClosed: (mapId) => {
    care.close();
    maps
      .open(mapId)
      .then(() => {
        void inventory.setMap(mapId);
        void territory.setMap(mapId);
        void hollow.setMap(mapId);
        void chat.setMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
      })
      .catch((err: unknown) => {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      });
    lobby.hide();
  },
});
// Login and the lobby come first, so a renderer that can't start never hides them.
const maps = createMapScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onClosed: (message) => {
    jobs.close();
    void battles.setMap(null);
    catalog.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    lobby.showMessage(message);
  },
  tileActions: combineTileActions(
    inventory.tileActions,
    home.tileActions,
    territory.tileActions,
    jobs.tileActions,
  ),
  layers: [hollowLayer, jobs.badges],
  // The tutorial's spotlight finds the home node on the map (the gather step).
  targets: { register: (target, locate) => tutorial.targets.register(target, locate) },
  // A piece of clothing found while playing (#43) shows a little note; night
  // falling and squishies going to or coming back from the Hollow (#21).
  onLiveEvent: (event) => {
    wardrobe.liveEvent(event);
    hollow.liveEvent(event);
    chat.liveEvent(event);
    // The player's own play may have earned a milestone (#44).
    milestones.liveEvent(event);
  },
});
// The squishy catalog (#14) opens from the button by the battle entry.
const catalog = createCatalogScreen({
  root: document.body,
  onCare: (mapId, speciesId) => {
    void care.openForSpecies(mapId, speciesId);
  },
});
// The tutorial (#47) draws its Tutorial Glade with the map screen and sits
// over it; it never blocks the lobby unless the server requires it first
// (decision A).
const tutorial = createTutorialScreen({
  root: document.body,
  glade: {
    open: async (mapId, stillWanted) => {
      // The Glade runs on the real game (tech spec §7): bag and gathering,
      // home base, battles, territory and the night, like a patch. No chat.
      glade = mapId;
      catalog.close();
      care.close();
      await chat.setMap(null);
      await maps.open(mapId);
      // Put away ("Later") while it loaded: the lobby stays.
      if (!stillWanted()) return;
      lobby.hide();
      home.setMap(mapId);
      void inventory.setMap(mapId);
      void territory.setMap(mapId);
      void hollow.setMap(mapId);
      void battles.setMap(mapId);
    },
    close: () => {
      glade = null;
      void battles.setMap(null);
      void inventory.setMap(null);
      void territory.setMap(null);
      void hollow.setMap(null);
      void chat.setMap(null);
      home.setMap(null);
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
  // The wardrobe step (design doc §26 step 12): the Wardrobe over the Glade.
  openWardrobe: () => {
    wardrobe.open();
  },
  onStep: (stepId) => {
    // The wardrobe step is done once the scarf is on: back to the Glade.
    if (stepId !== 'wardrobe' && wardrobe.debug?.open) wardrobe.close();
    // The Glade's page is found at its night: look once the step after it
    // comes up, and when a run ends.
    if (stepId === 'evolve' || stepId === null) lorebook.check();
    // Finishing the Glade is The First Patch (#44).
    if (stepId === null) milestones.check();
  },
});
// Found lore pages (design doc §16). Mounted after the tutorial, so its card
// sits over Sprout's layer.
const lorebook = createLorebook({ root: document.body });
// A milestone earned (#44): a little party, but never over a battle or a
// lore page (one card at a time).
const milestones = createMilestoneCelebration({
  root: document.body,
  busy: () => battles.debug !== null || lorebook.debug.showing !== null,
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
    catalog.close();
    care.close();
    jobs.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId) => {
    maps.open(mapId).then(
      () => {
        home.setMap(mapId);
        // A battle can make a squishy evolve: celebrate it now (#19).
        void care.celebrateNews(mapId);
        // And earn a milestone that waited for the battle to close (#44).
        milestones.check();
        return Promise.all([
          inventory.setMap(mapId),
          territory.setMap(mapId),
          hollow.setMap(mapId),
          chat.setMap(chatFor(mapId)),
        ]);
      },
      (err: unknown) => {
        // No map to go back to: no battle button over the lobby either.
        void battles.setMap(null);
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      },
    );
    lobby.hide();
  },
  onCatalog: (mapId) => {
    catalog.show(mapId);
  },
  // A reply landing while the lobby or catalog is up must not open a battle over it.
  canOpen: () => !lobby.isOpen && !catalog.isOpen && !closeUp.isOpen,
  devTools: import.meta.env.DEV,
  keeper: () => keeper.current,
  keeperWearing: () => wardrobe.wearing,
  onStep: (step) => {
    audio.cue(battleCue(step));
  },
});
// Temporary (squishy jobs): Team and Jobs buttons by the battle entry; the trays move them.
jobs.mountTeamButton(document.querySelector('.battle-entry-box'), () => maps.debug?.id ?? null);
/** Who is logged in now (a story finishing late must not open another player's lobby). */
let signedIn: PublicUser | null = null;
// Picking a Keeper (#42) comes right after signup, then the opening
// cinematic the first time (#46), then the tutorial and the lobby; Settings
// opens the picker again to change the Keeper for free.
const keeper = createKeeperScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onReady: (user) => {
    // The game never waits on the story (decision A): it resolves at once
    // for anyone who has seen it, or if it can't play.
    void cinematic.ensure(user).then(() => {
      if (signedIn?.id !== user.id) return;
      lobby.setUser(user);
      tutorial.setUser(user);
    });
  },
  onEditOpen: () => {
    void battles.setMap(null);
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    maps.close();
    catalog.close();
    care.close();
    lobby.stepOut();
  },
  onEditClosed: (saved) => {
    if (saved) lobby.showMessage(KEEPER_TEXT.changed);
    else lobby.show();
  },
});
// The opening cinematic, "The Great Scatter" (#46): once by itself after the
// Keeper pick, and again from Settings. It owns the screen while it plays.
const cinematic = createCinematicScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  canRender: () => stage !== null,
  audio,
  keeper: () => keeper.current,
  keeperWearing: () => wardrobe.wearing,
  onReplayOpen: () => {
    void battles.setMap(null);
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    maps.close();
    catalog.close();
    care.close();
    lobby.stepOut();
  },
  onReplayClosed: () => {
    lobby.show();
  },
});
// The wardrobe (#43): from the lobby, it owns the whole screen like the
// Keeper picker, and brings the lobby back when done.
const wardrobe = createWardrobeScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  keeper: () => keeper.current,
  onOpen: () => {
    void battles.setMap(null);
    void inventory.setMap(null);
    home.setMap(null);
    maps.close();
    catalog.close();
    lobby.stepOut();
  },
  onClosed: () => {
    // Opened by the tutorial's wardrobe step: back to the Glade.
    const run = glade;
    if (run === null) {
      lobby.show();
      return;
    }
    maps.open(run).then(
      () => {
        home.setMap(run);
        void inventory.setMap(run);
        void territory.setMap(run);
        void hollow.setMap(run);
        void battles.setMap(run);
      },
      () => {
        lobby.show();
      },
    );
  },
  devTools: import.meta.env.DEV,
});
// The starter pick (owner decision 2026-10-03): the first visit to a patch
// asks "Choose your friend!" before the map. It owns the screen while open.
const starters = createStarterScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onOpen: () => {
    void battles.setMap(null);
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    maps.close();
    lobby.stepOut();
  },
});
// The account's Patch Coins (#45), on the patch list; read fresh each time it shows.
const lobbyCoins = createCoinCounter({
  testId: 'lobby-coins',
  fetchBalance: async () => (await boutiqueApi.coins()).balance,
});
const lobby = mountLobby(document.body, {
  onOpen: async (mapId) => {
    catalog.close();
    care.close();
    try {
      await starters.ensure(mapId);
      await maps.open(mapId);
    } catch (err) {
      // The starter screen stepped the lobby out: bring it back with the
      // message, so a failed pick or map never leaves a blank screen.
      if (!lobby.isOpen) {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      }
      throw err;
    }
    void inventory.setMap(mapId);
    void territory.setMap(mapId);
    void hollow.setMap(mapId);
    void chat.setMap(chatFor(mapId));
    home.setMap(mapId);
    // Not awaited: the lobby shows its button once this resolves, and a
    // battle resumed here (after a refresh) must step it out again after that.
    void battles.setMap(mapId);
    // A page found on this patch while away (a rescue, a capture).
    lorebook.check();
  },
  listActions: () => [...tutorial.listActions(), ...wardrobe.listActions()],
  listHeader: () => {
    void lobbyCoins.refresh();
    return [lobbyCoins.node];
  },
  settings: () => [
    ...audio.settings(),
    ...keeper.settings(),
    ...cinematic.settings(),
    ...tutorial.settings(),
    ...lorebook.settings(),
  ],
});
mountAuth(document.body, {
  onChange: (user) => {
    battles.setUser(user);
    catalog.setUser(user);
    care.setUser(user);
    jobs.setUser(user);
    closeUp.setUser(user);
    inventory.setUser(user);
    territory.setUser(user);
    hollow.setUser(user);
    chat.setUser(user);
    home.setUser(user);
    wardrobe.setUser(user);
    starters.setUser(user);
    lorebook.setUser(user);
    milestones.setUser(user);
    maps.setUser(user);
    signedIn = user;
    cinematic.setUser(user);
    // The lobby and tutorial wait for a Keeper and the story (`onReady` above).
    keeper.setUser(user);
    if (!user) {
      lobbyCoins.set(null);
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
    cinematic: () => cinematic.debug,
    catalog: () => catalog.debug,
    inventory: () => inventory.debug,
    territory: () => territory.debug,
    hollow: () => hollow.debug,
    chat: () => chat.debug,
    raids: () => raidReport.debug,
    home: () => home.debug,
    care: () => care.debug,
    closeUp: () => closeUp.debug,
    wardrobe: () => wardrobe.debug,
    jobs: () => jobs.debug,
    starter: () => starters.debug,
    lore: () => lorebook.debug,
    milestones: () => milestones.debug,
    audio: () => audio.debug,
  };
}
