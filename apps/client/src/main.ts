import { createAudio } from './audio/audio.js';
import { battleCue, careCue, touchCue } from './audio/cues.js';
import { boot } from './engine/boot.js';
import { createRenderer, parseRendererPreference } from './engine/renderer.js';
import { pickInitialTier } from './engine/quality/tiers.js';
import { mountStage, type SceneBuilder, type Stage } from './engine/stage.js';
import { createBattleScreen } from './battle/battle-screen.js';
import { createWildPicker } from './battle/wild-picker.js';
import { createHollowScreen } from './hollow/hollow-screen.js';
import { createLandScreen } from './land/land-screen.js';
import { HollowLayer } from './hollow/hollow-layer.js';
import { createExploreScreen } from './explore/explore-screen.js';
import { createDarkLand, darkTiles, heartSeedOf } from './hollow/dark-land.js';
import { jobsApi } from './squishies/jobs/jobs-api.js';
import { createJourneyScreen } from './trading/journey-screen.js';
import { createPostScreen } from './trading/post-screen.js';
import { createPostFlags } from './trading/post-flags.js';
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
import { mountAccount } from './ui/account/account-screen.js';
import { mountAuth } from './ui/auth/auth-overlay.js';
import { createLoreBagEntry } from './lore/bag-entry.js';
import { createLorebook } from './lore/lorebook.js';
import { createMilestoneCelebration } from './milestones/milestone-celebration.js';
import { createKeeperScreen, KEEPER_TEXT } from './ui/keeper/keeper-screen.js';
import { mountLobby } from './ui/lobby/lobby-overlay.js';
import { boutiqueApi } from './ui/boutique/boutique-api.js';
import { createCoinCounter } from './ui/coins/coin-counter.js';
import { installStickyTaps } from './ui/sticky-taps.js';
import { createWardrobeScreen } from './ui/wardrobe/wardrobe-screen.js';
import { wardrobeBackTo, wardrobeFrom, type WardrobeFrom } from './ui/wardrobe/wardrobe-return.js';
import { createTrays, trayRow } from './ui/trays/trays.js';
import { findSpot } from './recipes/book-model.js';
import { createRecipeBook } from './recipes/recipe-book.js';
import { appUpdates } from './pwa/app-updates.js';
import { CLIENT_BUILD } from './pwa/build-info.js';
import { startPwa } from './pwa/pwa.js';
import { mountVersionMenu } from './pwa/version-menu.js';
import { createWhatsNew } from './whats-new/whats-new.js';
import { updateHold } from './pwa/update-hold.js';
import { createRaidReport, withRaidReport } from './raids/raid-report.js';
import { createStarterScreen } from './starters/starter-screen.js';
import { createTerritoryScreen } from './territory/territory-screen.js';
import { createFenceScreen, withFences } from './fences/fence-screen.js';
import { tutorialApi } from './tutorial/tutorial-api.js';
import { createTutorialScreen, opensByItself } from './tutorial/tutorial-screen.js';
import { el } from './ui/dom.js';
import { hexKey, hexToWorld, type Hex, type PublicUser } from '@heartpatch/shared';
import { HEX_SIZE } from './map/map-config.js';
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
// A tap sticks to the button it landed on, even one still sliding in (ui/sticky-taps.ts).
installStickyTaps(document);

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

// The map's controls live in two side trays (owner decision 2026-10-04):
// "Adventure" on the left, "My Home" on the right, with news as badges
// on their handles. Mounted first, so the lobby and catalog cover it.
const trays = createTrays({ root: document.body });
// Team and Jobs go in My Home (squishy jobs); their row shows itself
// whenever this box does (on a map), and not on the Tutorial Glade.
const jobsBox = el('div', { class: 'tray-jobs' });
jobsBox.hidden = true;
trays.slot('squishies').append(jobsBox);
/** The map whose HUD is on screen (null between maps): the Team and Jobs row follows it (#132). */
let hudMapId: string | null = null;
/** The patch of the battle on screen (its map is put away meanwhile). */
let battleMapId: string | null = null;

// The bag and gathering (#17): a Bag entry in the My Home tray, and the
// gather buttons in the tile chip.
// The Lorebook's tile at the top of the Bag and the Bag's sparkle (#307);
// the book itself (`lorebook`) is made below.
const loreBag = createLoreBagEntry(() => {
  lorebook.openAt(null);
});
const inventory = createInventoryScreen({
  root: document.body,
  entryRoot: trays.slot('heartpatch'),
  devTools: import.meta.env.DEV,
  // Something new in the bag may open a recipe book page. Gathers and crafts
  // say so at once; capture drops, rescues and gifts are noticed when the
  // player is back on the map (`onHudChange`) or opens the book.
  onCollected: () => {
    void recipeBook.check();
  },
  // The welcome-back card's "See Factory" (#294): home, where the Factory stands.
  onSeeFactory: () => {
    void home.open();
  },
  lore: loreBag,
  onBagOpen: () => {
    lorebook.refresh();
  },
});
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
const jobs = createJobs({
  root: document.body,
  isGlade: (mapId) => mapId === glade,
  // Finished work goes straight to the bag (owner decision 2026-10-06): the
  // board settles the map on screen (the bag's) before it reads its view.
  settle: () => inventory.refresh(),
});
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
    void land.setMap(null);
    void chat.setMap(null);
    void battles.setMap(null);
    home.setMap(null);
    explore.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId: string, from: CloseUpFrom) => {
    if (from === 'home') {
      home.setMap(mapId);
      explore.setMap(mapId);
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
        void land.setMap(mapId);
        void chat.setMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
        explore.setMap(mapId);
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
/** What's new (#220) is open: the other cards wait for it (one card at a time, #129). */
let whatsNewOpen = false;
// Territory (#15): Claim, Challenge and guards in the tile panel. A tile
// battle opens the battle screen, unless another screen sits over the map.
// The raid report (#16) rides along with territory onto every map: challenges
// on my land while I was away, my defense style, and replays in the battle screen.
const raidReport = createRaidReport({
  root: document.body,
  entryRoot: trays.slot('adventure'),
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
// Fences (#203) ride along too: building, repairing and taking down the
// fences on my land's edges, from the tile panel.
const fences = createFenceScreen();
const territory = withFences(
  withRaidReport(
    createTerritoryScreen({
      openBattle: (battle) => {
        if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen)
          battles.open(battle);
      },
    }),
    raidReport,
  ),
  fences,
);
// Land that misses you (owner decision 2026-10-06): my fading land drawn on
// the map, the "Some land misses you!" chip with Visit, and the welcome-back
// card for land that went wild while I was away.
const land = createLandScreen({
  root: document.body,
  setFade: (fade) => {
    maps.setLandFade(fade);
  },
  view: () => maps.view,
  // Land the Hollow Man won back is his report's and his show's to tell (#277).
  toldElsewhere: (tile) => hollow.reclaimed(tile.night, tile),
});
// The Hollow Man (#21): the night on the map, his visit when night falls,
// the morning report, and rescues (a rescue battle opens the battle screen).
const hollowLayer = new HollowLayer({ invalidate: () => stage?.invalidate() });
// My dark land (#277): a dashed edge and a 🌙 where no fire's light reaches.
const darkLand = createDarkLand(
  document.body,
  () => signedIn?.id ?? null,
  () => {
    hollow.viewChanged();
  },
);
/** Glides the camera to a tile (at once with reduced motion). */
const stillPans = window.matchMedia('(prefers-reduced-motion: reduce)');
const panToTile = (h: Hex): void => {
  stage?.camera.panTo(hexToWorld(h, HEX_SIZE), stillPans.matches);
};
// Trading posts' flags and rings on the map (#269), for whoever is signed in.
const postFlags = createPostFlags(document.body, () => signedIn?.id ?? null);
// Journeys to trading posts (#270): the preview in a post's tile panel, and
// a journey opens the battle screen like a tile battle.
// The post's screen (#271): Trade, Gift and Mailbox, from "Visit post".
const postScreen = createPostScreen({ root: document.body });
const journeys = createJourneyScreen({
  openBattle: (battle) => {
    if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen) battles.open(battle);
  },
  openPost: (post, view) => {
    // The tile panel steps aside: on iPad the post is a side panel beside the map.
    maps.deselect();
    postScreen.open(post, view);
  },
});
const hollow = createHollowScreen({
  root: document.body,
  entryRoot: trays.slot('adventure'),
  hintRoot: trays.slot('heartpatch'),
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
    walk: (keeper, beat, seed, still, done) => hollowLayer.walk(keeper, beat, seed, still, done),
    endWalks: () => {
      hollowLayer.endWalks();
    },
    get debug() {
      return hollowLayer.debug;
    },
  },
  // The night show (#277): his walks on the map, from the night's outcome.
  show: {
    hold: (held) => {
      maps.setHeld(held);
    },
    seedOf: (userId) => (maps.view ? heartSeedOf(maps.view, userId) : null),
    tileAt: (h) => maps.view?.tiles.find((t) => hexKey(t) === hexKey(h)),
    // A hush as he comes, a soft chime as the fire turns him back, a cold wind as he takes.
    cue: (kind) => {
      audio.cue(
        kind === 'enter'
          ? 'nightfall'
          : kind === 'recoil'
            ? 'twinkle'
            : kind === 'strike'
              ? 'cold-wind'
              : null,
      );
    },
    pan: panToTile,
  },
  darkLand: () => (maps.view && signedIn ? darkTiles(maps.view, signedIn.id) : []),
  showTile: (h, panel) => {
    if (panel) maps.focus(h);
    panToTile(h);
  },
  outInDark: async (mapId, tiles) => {
    const keys = new Set(tiles.map(hexKey));
    const view = await jobsApi.view(mapId);
    return view.squishies
      .filter((s) => {
        const at = s.post ?? s.work;
        return at !== null && keys.has(hexKey(at));
      })
      .map((s) => view.names[s.squishy.id] ?? '')
      .filter((name) => name !== '');
  },
  pvpMode: () => maps.view?.map.pvpMode ?? null,
  isGlade: (mapId) => mapId === glade,
  onStatus: () => {
    land.redraw();
  },
  // One card at a time (#277): the narrator and the nudge wait while
  // something else is up over the map.
  mapBusy: () =>
    (maps.debug?.selected ?? null) !== null ||
    trays.debug.open !== null ||
    care.isOpen ||
    closeUp.isOpen ||
    homeOpen() ||
    (explore.debug?.open ?? false) ||
    (land.debug?.welcome ?? false),
  // One card at a time (#129): the morning report waits behind the raid
  // report, a found lore page, a milestone party and What's new. (`lorebook`
  // and `milestones` are made below; this is only read at render time.)
  otherReportOpen: () =>
    raidReportOpen ||
    whatsNewOpen ||
    lorebook.debug.showing !== null ||
    lorebook.isOpen ||
    milestones.debug.showing !== null,
  openBattle: (battle) => {
    if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen) battles.open(battle);
  },
  devTools: import.meta.env.DEV,
});
/** The Hollow's morning report is on screen (it opens by itself; others wait). */
const hollowReportOpen = () => (hollow.debug?.report.length ?? 0) > 0;
// Quick messages (#23): a Chat button over a multiplayer map, with presets,
// emoji and squishy stickers, and little bubbles when someone says something.
const chat = createChatScreen({ root: document.body, entryRoot: trays.slot('top-right') });
// The home base (#18): a Home button over a multiplayer map opens the
// player's home tiles up close, where they build, fuel the fire and house
// squishies. Like battles, it owns the screen while open.
const home = createHomeScreen({
  root: document.body,
  entryRoot: trays.slot('heartpatch'),
  onProblem: (message) => {
    lobby.showMessage(message);
  },
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  keeper: () => keeper.current,
  keeperWearing: () => wardrobe.wearing,
  onJobs: (mapId, at) => {
    void jobs.openJobBoard(mapId, at);
  },
  showJobs: (mapId) => mapId !== glade,
  onRecipeBook: () => {
    recipeBook.open();
  },
  onOpen: (mapId) => {
    maps.close();
    catalog.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
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
        void land.setMap(mapId);
        void chat.setMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
        explore.setMap(mapId);
      })
      .catch((err: unknown) => {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      });
    lobby.hide();
  },
});
// Exploring your land (#199): "Explore" on a tile of mine opens it up
// close, where my Keeper walks and searches its spots. Like home base, it
// owns the screen while open; Back returns to the map.
const explore = createExploreScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  keeper: () => keeper.current,
  keeperWearing: () => wardrobe.wearing,
  mapTile: (at) => maps.view?.tiles.find((t) => t.q === at.q && t.r === at.r) ?? null,
  isGlade: (mapId) => mapId === glade,
  onOpen: () => {
    maps.close();
    catalog.close();
    care.close();
    jobs.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void chat.setMap(null);
    void battles.setMap(null);
    home.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId) => {
    maps
      .open(mapId)
      .then(() => {
        void inventory.setMap(mapId);
        void territory.setMap(mapId);
        void hollow.setMap(mapId);
        void land.setMap(mapId);
        void chat.setMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
        explore.setMap(mapId);
        // A page or a milestone found while exploring shows now (#129).
        lorebook.check();
        milestones.check();
      })
      .catch((err: unknown) => {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      });
    lobby.hide();
  },
  onProblem: (message) => {
    lobby.showMessage(message);
  },
  // Finds land in the bag: the recipe book may open a page for them.
  onFound: () => {
    void recipeBook.check();
  },
  onRecipeBook: () => {
    recipeBook.open();
  },
});
// Login and the lobby come first, so a renderer that can't start never hides them.
// Meet it on a tile with a rustling tuft (#209): the battle screen starts it.
const wildPicker = createWildPicker({ meet: (mapId, tile) => battles.meetWild(mapId, tile) });
const maps = createMapScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onClosed: (message) => {
    jobs.close();
    postScreen.close();
    void battles.setMap(null);
    catalog.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    explore.setMap(null);
    lobby.showMessage(message);
  },
  // Meet it first (#209): the tuft the player tapped is what they came for.
  tileActions: combineTileActions(
    wildPicker.tileActions,
    inventory.tileActions,
    home.tileActions,
    explore.tileActions,
    land.tileActions,
    fences.tileActions,
    territory.tileActions,
    jobs.tileActions,
    journeys.tileActions,
    // A tile's panel came up or went away: the night's cards step back or return.
    {
      show: () => {
        hollow.viewChanged();
      },
      hide: () => {
        hollow.viewChanged();
      },
    },
  ),
  onHudChange: (mapId) => {
    hudMapId = mapId;
    // The map is up: a new build's What's new may pop up now (#220).
    if (mapId !== null) whatsNew.maybePop();
    trays.setVisible(mapId !== null);
    recipeBook.setMap(mapId);
    // Hidden, then shown: the Team and Jobs row checks the map (not on the Glade).
    jobsBox.hidden = true;
    jobsBox.hidden = mapId === null;
    // Sprout points at the handles once, on a patch (the Glade has Sprout already).
    if (mapId !== null && signedIn && glade === null) trays.offerHint(signedIn.id);
  },
  layers: [hollowLayer, darkLand, jobs.badges, land.layer, postFlags],
  // The tutorial's spotlight finds the home node on the map (the gather step).
  targets: { register: (target, locate) => tutorial.targets.register(target, locate) },
  // A piece of clothing found while playing (#43) shows a little note; night
  // falling and squishies going to or coming back from the Hollow (#21).
  onLiveEvent: (event) => {
    wardrobe.liveEvent(event);
    hollow.liveEvent(event);
    land.liveEvent(event);
    fences.liveEvent(event);
    chat.liveEvent(event);
    // The player's own play may have earned a milestone (#44).
    milestones.liveEvent(event);
    journeys.liveEvent(event);
    postScreen.liveEvent(event);
  },
});
// The Keeper's Recipe Book (owner decision 2026-10-05): from the My
// Home tray. "Make it" uses the bag's own crafting; "Find on map" taps
// the player's nearest tile with the ingredient and glides there.
const recipeBook = createRecipeBook({
  root: document.body,
  entryRoot: trays.slot('heartpatch'),
  inventory,
  openHome: () => {
    void home.open();
  },
  spotFor: (resourceId) => {
    const view = maps.view;
    return view && signedIn ? findSpot(resourceId, view.tiles, signedIn.id) : null;
  },
  showOnMap: (h) => {
    const point = maps.focus(h);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (point) stage?.camera.panTo(point, still);
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
      explore.setMap(mapId);
      void inventory.setMap(mapId);
      void territory.setMap(mapId);
      void hollow.setMap(mapId);
      void land.setMap(mapId);
      void battles.setMap(mapId);
    },
    close: () => {
      glade = null;
      void battles.setMap(null);
      void inventory.setMap(null);
      void territory.setMap(null);
      void hollow.setMap(null);
      void land.setMap(null);
      void chat.setMap(null);
      home.setMap(null);
      explore.setMap(null);
      // A care sheet left open on the Glade (an evolution's "Whoa!") would
      // sit over the lobby's forms (#129).
      care.close();
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
// sits over Sprout's layer. One card at a time (#129): a page waits behind a
// battle, a milestone party, the morning report and What's new, and tells the
// report when it's gone.
const lorebook = createLorebook({
  root: document.body,
  bagEntry: loreBag,
  busy: () =>
    battles.debug !== null ||
    milestones.debug.showing !== null ||
    hollowReportOpen() ||
    whatsNewOpen,
  onChange: () => {
    hollow.otherReportChanged();
  },
});
// A milestone earned (#44): a little party, but never over a battle, a lore
// page, the morning report, What's new, an evolution's "Whoa!" or the wardrobe
// (one card at a time, #129).
// Nor over a form the player just asked for (the lobby's "Make a patch").
const milestones = createMilestoneCelebration({
  root: document.body,
  busy: () =>
    battles.debug !== null ||
    lorebook.debug.showing !== null ||
    lorebook.isOpen ||
    hollowReportOpen() ||
    whatsNewOpen ||
    (care.debug?.celebrating ?? false) ||
    (wardrobe.debug?.open ?? false) ||
    lobby.formOpen,
  onChange: () => {
    hollow.otherReportChanged();
  },
});
// Battles (#13) own the whole screen: the map and the lobby's button step
// out while one is open, and the map comes back after.
const battles = createBattleScreen({
  root: document.body,
  isGlade: (mapId) => mapId === glade,
  journey: {
    postName: (battleId) => journeys.postFor(battleId)?.name ?? null,
    ended: journeys.ended,
  },
  onWildHints: (mapId, tiles) => {
    wildPicker.setHints(mapId, tiles);
    maps.setWild(mapId, tiles);
  },
  // Find a squishy and the Catalog live in the Adventure tray.
  entryRoot: trays.slot('battle'),
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onOpen: (mapId) => {
    battleMapId = mapId;
    maps.close();
    catalog.close();
    care.close();
    jobs.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    explore.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId) => {
    battleMapId = null;
    maps.open(mapId).then(
      () => {
        home.setMap(mapId);
        explore.setMap(mapId);
        // A battle can make a squishy evolve: celebrate it now (#19).
        void care.celebrateNews(mapId);
        // And earn a milestone that waited for the battle to close (#44).
        milestones.check();
        // Made it to a trading post (#270, "Open the post"): show its panel.
        const arrived = journeys.takeArrival();
        if (arrived) maps.focus(arrived);
        return Promise.all([
          inventory.setMap(mapId),
          territory.setMap(mapId),
          hollow.setMap(mapId),
          land.setMap(mapId),
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
// Claiming starts from a tile: this row says how (territory, #15).
trays.slot('adventure').append(
  trayRow({
    icon: '🚩',
    label: 'Claim land',
    sub: 'Tap land next to yours',
    testId: 'tray-claim',
    onTap: () => {
      trays.say('Tap land next to yours, then Claim!');
    },
  }),
);
jobs.mountTeamButton(jobsBox, () => hudMapId);
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
    void land.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    explore.setMap(null);
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
    void land.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    explore.setMap(null);
    maps.close();
    catalog.close();
    care.close();
    lobby.stepOut();
  },
  onReplayClosed: () => {
    lobby.show();
  },
});
/**
 * The patch the player is on: its map (the Keeper menu shows only over one),
 * or, should the wardrobe ever open over them, the home base, close-up or
 * battle that put the map away for a moment. Null in the lobby.
 */
function patchOnScreen(): string | null {
  if (hudMapId !== null) return hudMapId;
  if (homeOpen()) return home.debug?.mapId ?? null;
  if (closeUp.isOpen) return closeUp.debug?.mapId ?? null;
  return battles.debug !== null ? battleMapId : null;
}
/** Where the wardrobe was opened, so "Done" goes back there. */
let wardrobeOpenedFrom: WardrobeFrom = null;
// The wardrobe (#43): it owns the whole screen like the Keeper picker, and
// "Done" goes back where it was opened: the patch (from the Keeper menu),
// the Glade (the tutorial's wardrobe step) or the lobby.
const wardrobe = createWardrobeScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  keeper: () => keeper.current,
  onOpen: () => {
    // Before anything is put away: the map's HUD goes with it.
    wardrobeOpenedFrom = wardrobeFrom({ lobbyOpen: lobby.isOpen, patch: patchOnScreen(), glade });
    void battles.setMap(null);
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    explore.setMap(null);
    maps.close();
    catalog.close();
    care.close();
    jobs.close();
    lobby.stepOut();
  },
  onClosed: () => {
    const mapId = wardrobeBackTo(wardrobeOpenedFrom, glade);
    wardrobeOpenedFrom = null;
    if (mapId === null) {
      lobby.show();
      return;
    }
    maps.open(mapId).then(
      () => {
        home.setMap(mapId);
        explore.setMap(mapId);
        void inventory.setMap(mapId);
        void territory.setMap(mapId);
        void hollow.setMap(mapId);
        void land.setMap(mapId);
        void chat.setMap(chatFor(mapId));
        // A battle left for the wardrobe resumes.
        void battles.setMap(mapId);
      },
      (err: unknown) => {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      },
    );
    lobby.hide();
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
    void land.setMap(null);
    void chat.setMap(null);
    home.setMap(null);
    explore.setMap(null);
    maps.close();
    lobby.stepOut();
  },
});
// The account's Patch Coins (#45), on the patch list; read fresh each time it shows.
const lobbyCoins = createCoinCounter({
  testId: 'lobby-coins',
  fetchBalance: async () => (await boutiqueApi.coins()).balance,
});
// Offline shell, update prompt, Add to Home Screen guide (issue #26). The
// guide is a card in the patch list (#135).
const installGuide = import.meta.env.PROD ? startPwa(document.body) : null;
// Grown-up helpers and new recovery codes (#197): Settings rows and helper asks.
const account = mountAccount(document.body);
const lobby = mountLobby(document.body, {
  // A patch is on screen (its map, or the home base, close-up or battle over
  // it): looking around goes back to it, with no "Back to my patches" pill (#212).
  patchOpen: () => patchOnScreen() !== null,
  buttonRoot: trays.slot('top-left'),
  // A reload lands back on the last patch (#160), unless a tutorial run
  // going opens the Glade by itself (the same rule the tutorial uses).
  canResume: async () => !opensByItself(await tutorialApi.state()),
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
    void land.setMap(mapId);
    void chat.setMap(chatFor(mapId));
    home.setMap(mapId);
    explore.setMap(mapId);
    // Not awaited: the lobby shows its button once this resolves, and a
    // battle resumed here (after a refresh) must step it out again after that.
    void battles.setMap(mapId);
    // A page found on this patch while away (a rescue, a capture).
    lorebook.check();
  },
  listActions: () => [
    ...tutorial.listActions(),
    ...wardrobe.listActions(),
    ...(installGuide?.cards() ?? []),
  ],
  listHeader: () => {
    void lobbyCoins.refresh();
    return [lobbyCoins.node, ...account.listHeader()];
  },
  settings: () => [
    ...audio.settings(),
    ...keeper.settings(),
    ...cinematic.settings(),
    ...tutorial.settings(),
    ...lorebook.settings(),
    ...account.settings(),
  ],
});
/** A row in the Keeper menu (the corner of the map). */
const menuRow = (icon: string, label: string, onTap: () => void): HTMLButtonElement => {
  const row = document.createElement('button');
  row.type = 'button';
  row.append(
    Object.assign(document.createElement('span'), { textContent: icon, ariaHidden: 'true' }),
    label,
  );
  row.addEventListener('click', onTap);
  return row;
};
// What's new (#220): the version line opens it, and after an update it pops
// up once over the map: never with no map up, over a battle, the tutorial,
// Sprout's tray hint, a screen over the map, another card (#129) or a held
// screen (#47). Those cards wait for it in turn (`whatsNewOpen`).
const whatsNew = createWhatsNew({
  root: document.body,
  client: CLIENT_BUILD,
  busy: () =>
    hudMapId === null ||
    updateHold.held ||
    lobby.isOpen ||
    battles.debug !== null ||
    (tutorial.debug !== null && tutorial.debug.phase !== 'closed') ||
    trays.debug.hint ||
    catalog.isOpen ||
    care.isOpen ||
    closeUp.isOpen ||
    (wardrobe.debug?.open ?? false) ||
    recipeBook.isOpen ||
    postScreen.isOpen ||
    raidReportOpen ||
    (land.debug?.welcome ?? false) ||
    lorebook.debug.showing !== null ||
    lorebook.isOpen ||
    milestones.debug.showing !== null ||
    hollowReportOpen(),
  onChange: () => {
    whatsNewOpen = whatsNew.debug.open;
    hollow.otherReportChanged();
  },
  canCopy: 'clipboard' in navigator,
  // async: a missing clipboard (an http page) rejects instead of throwing.
  copy: async (text) => navigator.clipboard.writeText(text),
});
// The game's version under the name, and "Update now" when one is ready (#198).
const version = mountVersionMenu({
  client: CLIENT_BUILD,
  updates: appUpdates,
  fetchServer: () => fetchHealth(),
  onOpen: () => {
    whatsNew.open();
  },
});
mountAuth(document.body, {
  menuHead: () => {
    version.refresh();
    return [version.line];
  },
  // Over the map, the rare things live in the Keeper menu in the corner.
  menu: () => [
    version.updateRow,
    menuRow('👗', 'Wardrobe', () => {
      wardrobe.open();
    }),
    menuRow('⚙️', 'Settings', () => {
      lobby.showSettings();
    }),
  ],
  onChange: (user) => {
    account.setUser(user);
    battles.setUser(user);
    catalog.setUser(user);
    care.setUser(user);
    jobs.setUser(user);
    closeUp.setUser(user);
    inventory.setUser(user);
    recipeBook.setUser(user);
    territory.setUser(user);
    journeys.setUser(user);
    postScreen.setUser(user);
    hollow.setUser(user);
    land.setUser(user);
    chat.setUser(user);
    home.setUser(user);
    explore.setUser(user);
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

if (import.meta.env.DEV) {
  // Read-only hook for the Playwright tests; dev builds only. Installed
  // before boot() so it exists before the first drawn frame marks the canvas
  // ready: the getters read whichever stage is on screen (null or 0 before one).
  window.__heartpatch = {
    renderer: () => stage?.renderer.kind ?? null,
    quality: () => stage?.quality.snapshot ?? null,
    camera: () => stage?.camera.state ?? null,
    draws: () => stage?.draws ?? 0,
    idle: () => stage?.idle ?? false,
    invalidate: () => stage?.invalidate(),
    map: () => maps.debug,
    trays: () => trays.debug,
    recipeBook: () => recipeBook.debug,
    tutorial: () => tutorial.debug,
    updatesHeld: () => updateHold.held,
    battle: () => battles.debug,
    battleDev: () => battles.dev,
    keeper: () => keeper.debug,
    cinematic: () => cinematic.debug,
    catalog: () => catalog.debug,
    inventory: () => inventory.debug,
    territory: () => territory.debug,
    fences: () => fences.debug,
    hollow: () => hollow.debug,
    land: () => land.debug,
    chat: () => chat.debug,
    raids: () => raidReport.debug,
    home: () => home.debug,
    explore: () => explore.debug,
    care: () => care.debug,
    closeUp: () => closeUp.debug,
    wardrobe: () => wardrobe.debug,
    jobs: () => jobs.debug,
    journey: () => journeys.debug,
    post: () => postScreen.debug,
    posts: () => ({
      shown: postFlags.shown,
      rings: postFlags.rings,
      onScreen: postFlags.onScreen,
    }),
    starter: () => starters.debug,
    lore: () => lorebook.debug,
    milestones: () => milestones.debug,
    whatsNew: () => whatsNew.debug,
    audio: () => audio.debug,
  };
}

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
}
