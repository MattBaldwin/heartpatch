import { createAudio } from './audio/audio.js';
import { battleCue, careCue, findCue, touchCue } from './audio/cues.js';
import { readBisectFlags, setBisectFlags } from './engine/bisect-flags.js';
import { boot } from './engine/boot.js';
import { createRenderer, parseRendererPreference } from './engine/renderer.js';
import { showsStats } from './engine/stats-flag.js';
import { setSlowFrames } from './engine/perf-report.js';
import { rareGlowOff, setRareGlowOff } from './procedural/rare-glow.js';
import { isQualityTier, pickInitialTier } from './engine/quality/tiers.js';
import { mountStage, type SceneBuilder, type Stage } from './engine/stage.js';
import { createBattleScreen } from './battle/battle-screen.js';
import { createDefensePrompt } from './battle/defense-prompt.js';
import { createWildPicker } from './battle/wild-picker.js';
import { createHollowScreen } from './hollow/hollow-screen.js';
import { createLandScreen } from './land/land-screen.js';
import { HollowLayer } from './hollow/hollow-layer.js';
import { createExploreScreen } from './explore/explore-screen.js';
import { createDarkLand, darkTiles, heartSeedOf } from './hollow/dark-land.js';
import { careApi } from './care/care-api.js';
import { jobsApi } from './squishies/jobs/jobs-api.js';
import { createJourneyScreen } from './trading/journey-screen.js';
import { createTrickOrTreat } from './trick-or-treat/trick-or-treat-screen.js';
import { createPostScreen } from './trading/post-screen.js';
import { createPostFlags } from './trading/post-flags.js';
import { createCommunityActions } from './hollowed/community-actions.js';
import { createCommunityFlags } from './hollowed/community-flags.js';
import { COMMUNITY_TEXT } from './hollowed/community-model.js';
import { restoreApi } from './hollowed/restore-api.js';
import { createKeyHunt } from './hollowed/key-hunt.js';
import { createRestoreSheet } from './hollowed/restore-sheet.js';
import { createFarHollowSheet } from './hollowed/far-hollow-sheet.js';
import { farHollowApi } from './hollowed/far-hollow-api.js';
import { justArrived } from './hollowed/far-hollow-model.js';
import { giftLine, newlyWon } from './hollowed/restore-view.js';
import { createHomeScreen } from './home/home-screen.js';
import { createHouseScreen } from './house/house-screen.js';
import { createInventoryScreen } from './inventory/inventory-screen.js';
import { createCatalogScreen } from './catalog/catalog-screen.js';
import { createCareSheet } from './care/care-sheet.js';
import { createJobs, openTeamPicker } from './squishies/jobs/index.js';
import { workMoods } from './squishies/jobs/jobs-view.js';
import { createChatScreen } from './chat/chat-screen.js';
import { createFriendlyScreen } from './friendly/friendly-screen.js';
import { createCloseUpScreen, type CloseUpFrom } from './close-up/close-up-screen.js';
import { onPanelFocus } from './building/panel-focus.js';
import { createTileBuild } from './building/tile-build.js';
import { combineTileActions } from './map/tile-actions.js';
import { createMapScreen, type MapLayer } from './map/map-screen.js';
import { seasonsOn } from './map/map-dressing.js';
import { createTileMarks } from './map/tile-marks.js';
import { newIdempotencyKey } from './net/idempotency-key.js';
import { fetchHealth } from './net/api.js';
import { buildTestScene } from './scenes/test-scene.js';
import { createCinematicScreen } from './cinematics/cinematic-screen.js';
import { mountAccount } from './ui/account/account-screen.js';
import { mountAuth } from './ui/auth/auth-overlay.js';
import { openPrivacy, PRIVACY_TEXT } from './ui/privacy/privacy-link.js';
import { createLoreBagEntry } from './lore/bag-entry.js';
import { createLorebook } from './lore/lorebook.js';
import { createMilestoneCelebration } from './milestones/milestone-celebration.js';
import { createKeeperScreen, KEEPER_TEXT } from './ui/keeper/keeper-screen.js';
import { mountLobby } from './ui/lobby/lobby-overlay.js';
import { lobbyApi } from './ui/lobby/lobby-api.js';
import { boutiqueApi } from './ui/boutique/boutique-api.js';
import { createCoinCounter } from './ui/coins/coin-counter.js';
import { createHeartCoinsScreen } from './heart-coins/heart-coins.js';
import { installStickyTaps } from './ui/sticky-taps.js';
import { installPressFeel } from './ui/button/button.js';
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
import { createPatchLine } from './patch-line/patch-line.js';
import { boxOf, SHEET_SELECTOR } from './tutorial/sheets.js';
import { updateHold } from './pwa/update-hold.js';
import { createRaidReport, withRaidReport } from './raids/raid-report.js';
import { createStarterScreen } from './starters/starter-screen.js';
import { createTerritoryScreen } from './territory/territory-screen.js';
import { createFenceScreen, withFences } from './fences/fence-screen.js';
import { tutorialApi } from './tutorial/tutorial-api.js';
import { createTutorialScreen, opensByItself } from './tutorial/tutorial-screen.js';
import { el, messageOf } from './ui/dom.js';
import {
  GAME_DATA,
  hexKey,
  hexToWorld,
  visualRegistry,
  type CommunityView,
  type Hex,
  type MapView,
  type PublicUser,
} from '@heartpatch/shared';
import { HEX_SIZE } from './map/map-config.js';
import { createPortraits } from './procedural/portraits.js';
import { createRosterSheet } from './squishies/roster/roster-sheet.js';
import { heroLodFor } from './procedural/motion.js';
import { squishiesButton } from './squishies/roster/squishies-entry.js';
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
// Every button squishes under the finger (ui/button/press.css).
installPressFeel(document);

const params = new URLSearchParams(window.location.search);
// `?rareglow=0` turns the rare glow off for a device frame-rate check with `?fps=1` (#391).
setRareGlowOff(rareGlowOff(params));
// `?nopost=1`, `?nowater=1`, `?nograss=1`, `?nosky=1`, `?noportraits=1`, `?cap30=1`: one cost
// off each, for the owner's device bisect with `?fps=1` (#501). Before anything is built.
setBisectFlags(readBisectFlags(params));
// Dev only: `?slow=1` pads every frame and keeps drawing, so the perf report fires (#501).
setSlowFrames(import.meta.env.DEV && params.get('slow') === '1');
// `?quality=` and `?renderer=webgpu` (opt-in, tech spec §6) stand in for the settings screen.
/**
 * Dev only: `?tier=` pins a tier for honest review captures (#335). The
 * governor is off, so headless software rendering can't drop it to low;
 * every capture says which tier it was taken at.
 */
const pinnedTier = import.meta.env.DEV ? params.get('tier') : null;
const pinTier = isQualityTier(pinnedTier);
/** The quality tier, carried from stage to stage so the governor's last step down isn't lost. */
let tier = pickInitialTier(pinnedTier, params.get('quality'));
let stage: Stage | null = null;
/** Test scenes built so far (the dev hook: a map↔explore switch builds none, #501 G). */
let testScenesBuilt = 0;
const testScene: SceneBuilder = (scene) => {
  testScenesBuilt++;
  return buildTestScene(scene);
};
/** What the stage draws: the open map, or the test scene. */
let sceneBuilder: SceneBuilder = testScene;
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

/** A `showScene(null)` waiting for its microtask. */
let blankPending = false;
/** What the stage on screen was built with. */
let shownBuilder: SceneBuilder | null = null;
/** Scene swaps so far (explore hands the screen back to the map, which shows its own). */
let sceneSwaps = 0;

/**
 * Swaps the scene on the running renderer (tech spec §6: one engine, scenes
 * swapped). Before the renderer starts, or after it failed, this only picks
 * what the next mount draws.
 *
 * `null` (a screen leaving) shows the test scene, a microtask later: a
 * screen opening in the same task (the map hides as explore opens) takes
 * its place before it's built, so a switch builds nothing it throws away
 * (#501 G: about 97 buffers and a few program links each time). The test
 * scene already on screen isn't rebuilt.
 */
function showScene(build: SceneBuilder | null): void {
  if (build !== null) {
    blankPending = false;
    swapScene(build);
    return;
  }
  sceneBuilder = testScene;
  if (blankPending) return;
  blankPending = true;
  queueMicrotask(() => {
    if (!blankPending) return;
    blankPending = false;
    if (stage && shownBuilder === testScene) return;
    swapScene(testScene);
  });
}
function swapScene(build: SceneBuilder): void {
  sceneBuilder = build;
  sceneSwaps++;
  if (!stage) return;
  const { renderer } = stage;
  const target = renderer.engine.getRenderingCanvas();
  currentStage.dispose();
  if (!target) return;
  try {
    stage = mounted(mountStage(renderer, target, sceneBuilder, tier, {}, pinTier));
    shownBuilder = sceneBuilder;
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
// Halloween's loop follows the server's season on the bag's game clock (#583).
// `inventory` is made below: `now` is only read once a tap has loaded the engine.
const audio = createAudio({ now: () => inventory.gameNow() });

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
// The real squishies for DOM screens, drawn once each on the game's engine
// (#375): the Squishies roster, the care sheet and the "what landed" banner
// (#465) share them.
const portraits = createPortraits({
  engine: () => stage?.renderer.engine ?? null,
  registry: visualRegistry(GAME_DATA),
  lod: () => heroLodFor(stage?.quality.snapshot.tier ?? tier),
  invalidate: () => stage?.invalidate(),
});
// The cellar key's treasure maps in the bag while a hunt is on (#306; filled by `keyHunt`).
const keyMapsInBag = document.createElement('div');
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
  // A settle charges the morning's upkeep (#601): the 💛 pill reads after it,
  // not alongside it (its own read on coming back can beat the charge).
  onSettled: () => {
    void heartCoins.refresh();
  },
  // The welcome-back card's "See Factory" (#294): its batches, wherever it
  // stands (on a homestead since #295).
  onSeeFactory: () => {
    inventory.openFactory();
  },
  lore: loreBag,
  keyMaps: keyMapsInBag,
  onBagOpen: () => {
    lorebook.refresh();
  },
  // What landed flies in from its tile on the map (#419).
  locate: {
    tile: (h) => maps.tileRect(h),
    home: () => maps.homeRect(),
    building: (id) => maps.buildingTile(id),
  },
  // The "what landed" banner stays below the patch's name, a wardrobe find
  // and the trays' hint line and first-visit hint (#419).
  clearOf: () => document.querySelectorAll('.map-hud, .wardrobe-toast, .tray-say, .tray-hint'),
  // Trained squishies show their faces (#465).
  portraits,
  // The server's time came with a reply (#583): the map's dressing, the music
  // and a journey panel drawn before it look again.
  onClockSync: () => {
    maps.reseason();
    audio.reseason();
    journeys.clockSynced();
    trickOrTreat.clockSynced();
  },
});
// Care (#19): one squishy's sheet (feed, pet, play, level and mood), opened
// from home base and the catalog; it celebrates an evolution the first time
// the player is back from the battle that caused it, or opens their home.
/** The patch whose roster the close-up returns to (opened from the roster), or null. */
let rosterReturn: string | null = null;
// The Squishies roster (#375): every squishy with its happiness, evolution,
// rarity and job, one tap from the top bar on the map, at home and in
// explore. Its Care opens the care sheet over it (two taps to care).
const roster = createRosterSheet({
  root: document.body,
  portraits,
  hasJobs: (mapId) => mapId !== glade,
  onCare: (mapId, squishyId) => {
    // The care sheet covers the roster, which comes back when it closes. On the
    // Tutorial Glade the roster closes instead, so the tutorial's path stays one
    // sheet deep (All done, then Back to map).
    if (mapId === glade) roster.close();
    else roster.setCovered(true);
    void care.open(mapId, squishyId);
  },
  // Up close and Dress up hand the screen to the close-up, which returns
  // to the roster when it's done.
  onCloseUp: (mapId, squishyId) => {
    rosterReturn = mapId;
    roster.close();
    void closeUp.open(mapId, squishyId, homeOpen() ? 'home' : 'map');
  },
  onDressUp: (mapId, squishyId) => {
    rosterReturn = mapId;
    roster.close();
    void closeUp.open(mapId, squishyId, homeOpen() ? 'home' : 'map', { dressUp: true });
  },
  // The Keeper's house (#381): a row's "Move into the house" opens the house's
  // picker on it, from Home on that patch (the house steps in over Home).
  canMoveIntoHouse: (mapId) => homeOpen() && home.debug?.mapId === mapId,
  // Never over home's banner, the map's patch name or the account chip: a long detail scrolls in the sheet.
  coveredTop: () => {
    let bottom = 0;
    for (const node of document.querySelectorAll<HTMLElement>(
      '.home-top, .auth-chip, .map-hud-title',
    )) {
      const box = node.getBoundingClientRect();
      if (node.closest('[hidden]') || box.height === 0) continue;
      bottom = Math.max(bottom, box.bottom);
    }
    return bottom;
  },
  onMoveIntoHouse: (mapId, current, squishyId) => {
    roster.close();
    void house.open(mapId, current, { pick: squishyId });
  },
});
// Heart Coins (#601): each patch's own balance, a 💛 pill on the map's name
// card and on Home's peek bar, and a line on each patch-list card. Never on
// the Tutorial Glade: it pays none.
const heartCoins = createHeartCoinsScreen({
  root: document.body,
  now: () => inventory.gameNow(),
  // By the sheet's own patch's date, as the map dresses its seasons (#583).
  // Its zone is remembered: Home closes the map, but the sheet opens there too.
  seasons: (at) => {
    const zone = heartCoinsZone;
    return zone === null ? null : seasonsOn(zone, at);
  },
});
/** The time zone of the patch the Heart Coins sheet shows, or null if not known. */
let heartCoinsZone: string | null = null;
const heartCoinsOn = (mapId: string): void => {
  const view = maps.view;
  if (view?.map.id === mapId) heartCoinsZone = view.map.timeZone;
  else if (heartCoins.debug.mapId !== mapId) heartCoinsZone = null;
  heartCoins.setMap(mapId === glade ? null : mapId);
};
const care = createCareSheet({
  root: document.body,
  portraits,
  // The roster under it reads again, so its hearts show the care just given.
  onClosed: () => {
    roster.setCovered(false);
    void roster.refresh();
    // Full-value care pays Heart Coins on this patch (#601).
    void heartCoins.refresh();
    // A village won in the same battle waited for the evolution to be seen (#592).
    showWonVillages();
    // So did the far Hollow's sheet after the far road (#306 PR 6).
    showFarHollowArrival();
  },
  onSquish: (kind) => {
    audio.cue(careCue(kind));
  },
  onCloseUp: (mapId, squishyId) => {
    // From a care sheet over the roster: the roster steps aside and comes back after.
    if (roster.isOpen) {
      rosterReturn = mapId;
      roster.close();
    }
    void closeUp.open(mapId, squishyId, homeOpen() ? 'home' : 'map');
  },
});
// Squishy jobs (owner decisions 2026-10-04): the job board and team picker
// sheets. Temporary entry points the trays will move: home's "Jobs & team",
// the tile panel's "Send a gatherer", and Team / Jobs by the battle entry.
// One quiet mark on my own tiles that need me (#602): my gatherers' now,
// #601's resource buildings' later. One map layer, handed to each feature.
const tileMarks = createTileMarks(document.body);
const jobs = createJobs({
  root: document.body,
  marks: tileMarks,
  invalidate: () => stage?.invalidate(),
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
  // The account chip sits over the top of the view (#340).
  coveredTop: () => {
    const chip = document.querySelector<HTMLElement>('.auth-chip');
    return chip && !chip.hidden ? chip.getBoundingClientRect().bottom : 0;
  },
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
    roster.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void socialSetMap(null);
    void battles.setMap(null);
    home.setMap(null);
    explore.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId: string, from: CloseUpFrom) => {
    const backToRoster = rosterReturn === mapId;
    rosterReturn = null;
    if (from === 'home') {
      home.setMap(mapId);
      explore.setMap(mapId);
      // Home base celebrates an evolution as it opens (#19).
      void home.open().then(() => {
        if (backToRoster) void roster.open(mapId);
      });
      return;
    }
    maps
      .open(mapId)
      .then(() => {
        void inventory.setMap(mapId);
        void territory.setMap(mapId);
        void hollow.setMap(mapId);
        void land.setMap(mapId);
        void socialSetMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
        explore.setMap(mapId);
        void care.celebrateNews(mapId);
        if (backToRoster) void roster.open(mapId);
      })
      .catch((err: unknown) => {
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      });
    lobby.hide();
  },
  onProblem: (message) => {
    // It didn't open: nothing to return to the roster from.
    rosterReturn = null;
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
/** How close the camera moves in on a tile being built on, so its edges are easy to tap. TUNE: */
const BUILD_ZOOM = 12;
/** How far up and how close a won village's ring shows above its card (#306 PR 3). TUNE: */
const RING_RAISE = 0.3;
const RING_ZOOM = 16;
const panToTile = (h: Hex): void => {
  stage?.camera.panTo(hexToWorld(h, HEX_SIZE), stillPans.matches);
};
// Trading posts' flags and rings on the map (#269), for whoever is signed in.
const postFlags = createPostFlags(document.body, () => signedIn?.id ?? null);
// Hollowed villages (#306): a flag over each (after the posts', so it keeps
// clear of theirs), and the village's block in a tile's panel.
const communityFlags = createCommunityFlags(document.body, () => signedIn?.id ?? null);
const communityActions = createCommunityActions(() => signedIn?.id ?? null);
// Journeys to trading posts (#270): the preview in a post's tile panel, and
// a journey opens the battle screen like a tile battle.
// The post's screen (#271): Trade, Gift and Mailbox, from "Visit post".
// A visit pass ends on the server's clock, so both count it down on the bag's
// game clock, not the device's (#561), as the recipe book does.
// A sale at its Sell tab (#601 PR 4) moves the bag and the 💛 pill: both read again.
const postScreen = createPostScreen({
  root: document.body,
  now: () => inventory.gameNow(),
  onSold: () => {
    void inventory.refresh();
    void heartCoins.refresh();
  },
});
const journeys = createJourneyScreen({
  now: () => inventory.gameNow(),
  openBattle: (battle) => {
    if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen) battles.open(battle);
  },
  openPost: (post, view) => {
    // The tile panel steps aside: on iPad the post is a side panel beside the map.
    maps.deselect();
    postScreen.open(post, view);
  },
  openFarHollow: (post) => {
    farHollowPost = post;
    void farHollowSheet.open(post);
  },
});
// The far Hollow (#306 PR 6): my own far Hollow each season, from any open
// trading post's panel. The far road is a journey (the battle screen's card
// says "Let's see"); the house screen is #306 6c.
let farHollowPost: { q: number; r: number } | null = null;
/** A far road won, waiting for the map to come back to open the sheet. */
let farHollowArrived = false;
/**
 * A journey won that this device didn't start (a reload mid-battle): it may
 * have been the far road. The map's live events stop while a battle is open,
 * so once it closes we ask (#306 PR 6).
 */
let farHollowMaybe = false;
/** Made it to the far Hollow ("Let's see"): its sheet, once an evolution's "Whoa!" is seen (#592). */
const showFarHollowArrival = (): void => {
  if (evolutionPending || care.isOpen) return;
  if (farHollowArrived) {
    farHollowArrived = false;
    farHollowMaybe = false;
    void farHollowSheet.open(farHollowPost);
    return;
  }
  const mapId = maps.view?.map.id;
  if (!farHollowMaybe || !mapId) return;
  farHollowMaybe = false;
  farHollowApi.view(mapId).then(
    (view) => {
      if (justArrived(view) && maps.view?.map.id === mapId) void farHollowSheet.open(null);
    },
    () => undefined,
  );
};
const farHollowSheet = createFarHollowSheet({
  root: document.body,
  mapId: () => maps.view?.map.id ?? null,
  openBattle: (battle) => {
    if (!lobby.isOpen && !catalog.isOpen && !care.isOpen && !closeUp.isOpen) battles.open(battle);
  },
  onOpen: () => {
    maps.deselect();
  },
});
// Trick-or-treat (#515): a patch-mate's home tile gets a "Trick or treat!"
// button, and a lit home a porch lantern. A treat may be Heartdust: the bag
// reads again.
/** My Partner on a patch, for the trick-or-treat door: the oldest of my squishies, its first one. */
const partnerLook = async (mapId: string) => {
  const { squishies, speciesDefs } = await careApi.list(mapId);
  const first = squishies[0];
  if (!first) return null;
  const species =
    speciesDefs.find((s) => s.id === first.speciesId) ??
    GAME_DATA.species.find((s) => s.id === first.speciesId);
  return species ? { species, instanceId: first.id, accessory: first.accessory } : null;
};
const trickOrTreat = createTrickOrTreat({
  root: document.body,
  // The patch's midnight is the server's: counted on the bag's game clock (#583).
  now: () => inventory.gameNow(),
  isGlade: (mapId) => mapId === glade,
  light: (mapId, userIds) => {
    maps.setPorchLanterns(mapId, userIds);
  },
  onTreat: (visit) => {
    if (visit.prize.kind === 'heartdust') void inventory.refresh();
  },
  // The porch shows my real Keeper and Partner, and a costume's card shows it worn.
  portraits,
  keeper: () => (keeper.current ? { config: keeper.current, wearing: wardrobe.wearing } : null),
  partner: partnerLook,
  heartdust: () => inventory.debug?.items['heartdust'] ?? null,
  wear: (itemId) => {
    void wardrobe.wearNow(itemId);
  },
  // "Dress up!" opens the squishy picker on my Partner, as the roster's Dress up does.
  dressUp: (mapId) => {
    void partnerLook(mapId).then((p) => {
      if (p) void closeUp.open(mapId, p.instanceId, 'map', { dressUp: true });
    });
  },
  cue: (name) => {
    audio.cue(name);
  },
  onChange: () => {
    hollow.otherReportChanged();
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
      communityActions.setNight(night);
      explore.setNight(night);
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
/**
 * The patch's social screens follow the map on screen together: quick
 * messages (#23) and friendly battles (#29). Null hides them (the Glade,
 * another screen over the map).
 */
const socialSetMap = (mapId: string | null): Promise<void> => {
  void friendly.setMap(mapId);
  return chat.setMap(mapId);
};
/** The patch each view's Squishies button opens the roster for. */
const rosterMapId: { home: string | null; explore: string | null } = { home: null, explore: null };
const homeSquishies = squishiesButton(() => {
  if (rosterMapId.home) void roster.open(rosterMapId.home);
}, 'home');
homeSquishies.hidden = true;
// In explore it sits under Back, so the tile's name keeps the top row.
const exploreSquishies = squishiesButton(() => {
  if (rosterMapId.explore) void roster.open(rosterMapId.explore);
}, 'explore');
exploreSquishies.hidden = true;
document.body.append(homeSquishies, exploreSquishies);
// The home base (#18): a Home button over a multiplayer map opens the
// player's home tiles up close, where they build, fuel the fire and house
// squishies. Like battles, it owns the screen while open.
/** Home's Build sheet asked for the recipe book (#537): it opens once the map is back. */
let bookFromHome = false;
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
  // My Crafting Factory's tile card (#295): its batches sheet, read fresh, so
  // an upgrade or build from the card a moment ago shows.
  onOpenFactory: () => {
    void inventory.refresh().then(() => {
      inventory.openFactory();
    });
  },
  // A resource building's card (#601 PR 7): Collect is a settle (owner
  // decision Q3); Upkeep is the Heart Coins sheet's order (Q5).
  onCollect: () => inventory.refresh(),
  onUpkeep: () => {
    heartCoins.openUpkeep();
  },
  now: () => inventory.gameNow(),
  onJobs: (mapId, at) => {
    void jobs.openJobBoard(mapId, at);
  },
  showJobs: (mapId) => mapId !== glade,
  // The name card's ideas come from my home ring's land (#306).
  mapView: () => maps.view,
  loadWorkMoods: (mapId) => {
    jobs.loadView(mapId);
  },
  // Home closes next; the book opens once the map is back (#537).
  onRecipeBook: () => {
    bookFromHome = true;
  },
  onOpen: (mapId) => {
    rosterMapId.home = mapId;
    homeSquishies.hidden = false;
    heartCoinsOn(mapId);
    roster.close();
    maps.close();
    catalog.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void socialSetMap(null);
    void battles.setMap(null);
    lobby.stepOut();
    void care.celebrateNews(mapId);
  },
  // The peek bar's Squishies (#412) opens the roster, like 🐾 at the top (#375).
  onSquishies: (mapId) => {
    void roster.open(mapId);
  },
  peekCorner: heartCoins.homePill,
  onCloseUp: (mapId, squishyId) => {
    audio.cue('squeak');
    void closeUp.open(mapId, squishyId, 'home');
  },
  // The Keeper's house (#381): only offered while the server switch is on for the player.
  onHouse: (mapId, current) => house.open(mapId, current),
  onClosed: (mapId) => {
    homeSquishies.hidden = true;
    roster.close();
    care.close();
    maps
      .open(mapId)
      .then(() => {
        void inventory.setMap(mapId);
        void territory.setMap(mapId);
        void hollow.setMap(mapId);
        void land.setMap(mapId);
        void socialSetMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
        explore.setMap(mapId);
        // "📖 Recipe book" on home's Build sheet (#537): shutting the book goes home again.
        if (bookFromHome) {
          bookFromHome = false;
          recipeBook.open(() => void home.open());
        }
      })
      .catch((err: unknown) => {
        bookFromHome = false;
        lobby.showMessage(err instanceof Error ? err.message : 'Oops, something went wobbly.');
      });
    lobby.hide();
  },
});
// The Keeper's house (#381): the dollhouse you step into from home. Like
// the close-up it owns the screen while open; Back goes home again.
const house = createHouseScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  // The windows follow the patch's clock (#381 H2), read before the map steps out.
  timeZone: () => maps.view?.map.timeZone ?? null,
  cue: (name) => {
    audio.cue(name);
  },
  tier: () => stage?.quality.snapshot.tier ?? tier,
  keeper: () => keeper.current,
  keeperWearing: () => wardrobe.wearing,
  coveredTop: () => {
    const chip = document.querySelector<HTMLElement>('.auth-chip');
    return chip && !chip.hidden ? chip.getBoundingClientRect().bottom : 0;
  },
  portraits,
  // Only while Home is still open on that patch when the reply lands.
  canOpen: (mapId) => homeOpen() && home.debug?.mapId === mapId,
  onOpen: () => {
    care.close();
    home.setMap(null);
    explore.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId) => {
    home.setMap(mapId);
    explore.setMap(mapId);
    void home.open();
  },
  onProblem: (message) => {
    lobby.showMessage(message);
  },
});
// Exploring your land (#199): "Explore" on a tile of mine opens it up
// close, where my Keeper walks and searches its spots. Like home base, it
// owns the screen while open; Back returns to the map.
const explore = createExploreScreen({
  root: document.body,
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  expectHitch: () => stage?.quality.expectHitch(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  pinned: () => pinTier,
  keeper: () => keeper.current,
  keeperWearing: () => wardrobe.wearing,
  mapTile: (at) => maps.view?.tiles.find((t) => t.q === at.q && t.r === at.r) ?? null,
  timeZone: () => maps.view?.map.timeZone ?? null,
  isGlade: (mapId) => mapId === glade,
  onOpen: (mapId) => {
    rosterMapId.explore = mapId;
    exploreSquishies.hidden = false;
    roster.close();
    maps.close();
    catalog.close();
    care.close();
    jobs.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void socialSetMap(null);
    void battles.setMap(null);
    home.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId) => {
    exploreSquishies.hidden = true;
    roster.close();
    // The map shows its own scene; until then explore's stays (#501 G). If
    // the map doesn't open, nothing else will, so the test scene shows.
    const swaps = sceneSwaps;
    // A remount meanwhile (a lost context) builds the test scene, never the closed tile.
    sceneBuilder = testScene;
    const noScene = (): void => {
      if (sceneSwaps === swaps) showScene(null);
    };
    maps
      .open(mapId)
      .then(() => {
        noScene();
        void inventory.setMap(mapId);
        void territory.setMap(mapId);
        void hollow.setMap(mapId);
        void land.setMap(mapId);
        void socialSetMap(chatFor(mapId));
        void battles.setMap(mapId);
        home.setMap(mapId);
        explore.setMap(mapId);
        // A page or a milestone found while exploring shows now (#129).
        lorebook.check();
        milestones.check();
      })
      .catch((err: unknown) => {
        noScene();
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
  // "Open Lorebook" on a find card (#307): the book opens over exploring, at that page.
  onLorebook: (pageId) => {
    lorebook.openAt(pageId);
  },
});
// A grey village tile's Explore (#306 2a): the same explore view, on a tile my land touches.
communityActions.wire('explore', (_community, tile) => {
  void explore.open(tile);
});
// Restoring a grey village tile, and naming a won village (#306 PR 3).
const restoreSheet = createRestoreSheet({
  root: document.body,
  mapId: () => maps.view?.map.id ?? null,
  members: () => maps.view?.members ?? [],
  expectHitch: () => stage?.quality.expectHitch(),
  onOpen: () => {
    maps.deselect();
  },
  // Above the sheet along the bottom; a won ring a little wider, so all of it shows.
  reveal: (at, wide) => {
    stage?.camera.panTo(
      hexToWorld(at, HEX_SIZE),
      stillPans.matches,
      wide ? RING_RAISE : 0.34,
      wide ? RING_ZOOM : BUILD_ZOOM,
    );
  },
  // The joy card closed: a won village's key map card shows next (#306 PR 2c).
  onClose: () => {
    keyHunt.showWaiting();
  },
});
// A won Hollow's key hunt and hidden cellar (#306 PR 2c; owner decision
// 2026-10-22): the treasure map (in the bag too), the key tile's gold glow
// and panel, the cellar door on the square, and down into it. The key itself
// is found by exploring its tile.
const keyHunt = createKeyHunt({
  root: document.body,
  me: () => signedIn?.id ?? null,
  mapId: () => maps.view?.map.id ?? null,
  bag: keyMapsInBag,
  showKey: (at) => {
    inventory.closeBag();
    const point = maps.focus(at);
    if (point) stage?.camera.panTo(point, stillPans.matches);
  },
  enterCellar: (communityId) => {
    void explore.openCellar(communityId);
  },
  // The joy card's own queue counts too (#592): after a battle the care sheet
  // may still be fetching before its "Whoa!" or the joy card opens.
  busy: () => evolutionPending || wonWaiting.length > 0 || restoreSheet.isOpen || care.isOpen,
});
communityActions.wire('restore', (community, tile) => {
  restoreSheet.open(community, tile);
});
communityActions.wire('name', (community) => {
  restoreSheet.openName(community);
});
// A village I won in a battle (#306 PR 4): the restore sheet's joy card, when
// a newer view shows it mine (my own restore sheet's win shows it already).
// Only the last map seen: a win missed while on another patch or across a
// reload shows on the map, without the card.
let villagesSeen: { mapId: string; communities: readonly CommunityView[] } | null = null;
// A battle win that also evolves a squishy opens the care sheet's "Whoa!" (#19):
// the joy card waits until that closes, so the two never stack (#592).
const wonWaiting: CommunityView[] = [];
let evolutionPending = false;
const showWonVillages = (): void => {
  if (evolutionPending || care.isOpen) return;
  for (const won of wonWaiting.splice(0)) restoreSheet.openWon(won);
};
const watchWins = (view: MapView): void => {
  const communities = view.communities ?? [];
  const before = villagesSeen?.mapId === view.map.id ? villagesSeen.communities : null;
  if (villagesSeen?.mapId !== view.map.id) wonWaiting.length = 0;
  villagesSeen = { mapId: view.map.id, communities };
  if (!before) return;
  wonWaiting.push(...newlyWon(before, communities, signedIn?.id ?? null));
  showWonVillages();
};
const villageWins: MapLayer = {
  attach: (_scene, view) => {
    watchWins(view);
  },
  update: watchWins,
};
// A won Old Well's or Bakery's morning gift (#306 PR 3b), collected on its square.
communityActions.wireGift(async (community) => {
  const mapId = maps.view?.map.id;
  if (!mapId) return { ok: false, text: messageOf(null) };
  try {
    const { gift } = await restoreApi.gift(mapId, community.id, newIdempotencyKey());
    void inventory.refresh();
    return { ok: true, text: COMMUNITY_TEXT.giftGot(giftLine(gift)) };
  } catch (err) {
    return { ok: false, text: messageOf(err) };
  }
});
// Login and the lobby come first, so a renderer that can't start never hides them.
// Meet it on a tile with a rustling tuft (#209): the battle screen starts it.
const wildPicker = createWildPicker({ meet: (mapId, tile) => battles.meetWild(mapId, tile) });
// One Build sheet for my land (#371): fires, lanterns, Training Grounds and
// fences, built the same way from the tile's panel.
// A sheet or fence card with the whole panel: the side trays' handles would
// sit on top of it, so they step aside until it's done.
onPanelFocus((focused) => {
  trays.setVisible(!focused);
});
const tileBuild = createTileBuild({
  // Clear land (#242) sits with the buildings it makes room for.
  sources: [home.buildSource, inventory.clearSource, fences.buildSource],
  area: () => maps,
  onRecipeBook: () => {
    recipeBook.open();
  },
  reveal: (tile) => {
    // Above the sheet along the bottom, so the lit edges stay in view.
    stage?.camera.panTo(hexToWorld(tile, HEX_SIZE), stillPans.matches, 0.34, BUILD_ZOOM);
  },
});
const maps = createMapScreen({
  root: document.body,
  // Decor and tile seasons by the server's date, not the phone's (#583): the
  // clock is read alongside the view, so the first build is dressed right.
  now: () => new Date(inventory.gameNow()),
  syncClock: (mapId) => inventory.syncClock(mapId),
  showScene,
  invalidate: () => stage?.invalidate(),
  requestFrame: () => stage?.requestFrame(),
  tier: () => stage?.quality.snapshot.tier ?? tier,
  onClosed: (message) => {
    restoreSheet.close();
    farHollowSheet.close();
    keyHunt.close();
    roster.close();
    jobs.close();
    postScreen.close();
    void battles.setMap(null);
    catalog.close();
    roster.close();
    care.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void socialSetMap(null);
    home.setMap(null);
    explore.setMap(null);
    lobby.showMessage(message);
  },
  // Meet it first (#209): the tuft the player tapped is what they came for.
  tileActions: combineTileActions(
    wildPicker.tileActions,
    // Who gathers here and how they feel (#602): the map shows only the squishy, so the tap says it.
    jobs.workerLine,
    inventory.tileActions,
    // A Hollowed village's words and its Explore and Restore (#306).
    communityActions,
    // A won village's cellar door, and its key's tile (#306 PR 2c).
    keyHunt.tileActions,
    // Build sits near the top of a tile's actions, so it's never scrolled away.
    tileBuild.tileActions,
    home.tileActions,
    explore.tileActions,
    land.tileActions,
    fences.tileActions,
    territory.tileActions,
    jobs.tileActions,
    journeys.tileActions,
    // On a patch-mate's home in the Halloween season (#515).
    trickOrTreat.tileActions,
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
  hudExtras: [heartCoins.mapPill],
  onHudChange: (mapId) => {
    hudMapId = mapId;
    // Back on the map (after a battle, home, the lobby): read its Heart Coins again.
    if (mapId !== null) heartCoinsOn(mapId);
    // The map is up: a new build's What's new may pop up now (#220).
    if (mapId !== null) whatsNew.maybePop();
    trays.setVisible(mapId !== null);
    mapSquishies.hidden = mapId === null || mapId === glade;
    recipeBook.setMap(mapId);
    // Hidden, then shown: the Team and Jobs row checks the map (not on the Glade).
    jobsBox.hidden = true;
    jobsBox.hidden = mapId === null;
    // Sprout points at the handles once, on a patch (the Glade has Sprout already).
    if (mapId !== null && signedIn && glade === null) trays.offerHint(signedIn.id);
  },
  layers: [
    hollowLayer,
    darkLand,
    jobs.gatherers,
    land.layer,
    postFlags,
    communityFlags,
    villageWins,
    keyHunt.layer,
    trickOrTreat.layer,
    // Last: each frame the marks keep clear of the flags placed just before them.
    tileMarks,
  ],
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
    // Friendly battles (#29): asks, and a live battle's turns and cheers.
    friendly.liveEvent(event);
    battles.liveEvent(event);
    // The player's own play may have earned a milestone (#44).
    milestones.liveEvent(event);
    journeys.liveEvent(event);
    trickOrTreat.liveEvent(event);
    postScreen.liveEvent(event);
    defense.liveEvent(event);
    // A patch-mate's Legendary friend (#391).
    patchLine.liveEvent(event);
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
      roster.close();
      care.close();
      await socialSetMap(null);
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
      void socialSetMap(null);
      home.setMap(null);
      explore.setMap(null);
      // A care sheet left open on the Glade (an evolution's "Whoa!") would
      // sit over the lobby's forms (#129).
      roster.close();
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
// report when it's gone. Nor over a form the player just asked for (the
// lobby's "Make a patch"), like the party.
const lorebook = createLorebook({
  root: document.body,
  bagEntry: loreBag,
  busy: () =>
    battles.debug !== null ||
    milestones.debug.showing !== null ||
    hollowReportOpen() ||
    whatsNewOpen ||
    lobby.formOpen ||
    // Exploring has its own find card, which says where the page went (#307):
    // the found-page card waits for Back.
    (explore.debug?.open ?? false),
  onChange: () => {
    hollow.otherReportChanged();
  },
});
// A milestone earned (#44): a little party, but never over a battle, a lore
// page, the morning report, What's new, an evolution's "Whoa!" or the wardrobe
// (one card at a time, #129).
// Nor over a form the player just asked for (the lobby's "Make a patch").
// "Defend now?" (#29-C): over any screen while a rival challenges land my
// squishies stand watch on; "Defend!" opens the battle from my side.
const defense = createDefensePrompt({
  root: document.body,
  nameOf: (userId) => maps.view?.members.find((m) => m.user.id === userId)?.user.username ?? null,
  openBattle: (battle) => {
    // The server has seated them already: whatever is open steps aside.
    catalog.close();
    rosterReturn = null; // the close-up swoops out to the battle, not back to the roster
    roster.close();
    care.close();
    closeUp.close();
    battles.open(battle);
  },
});
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
    trickOrTreat.isOpen ||
    lobby.formOpen,
  onChange: () => {
    hollow.otherReportChanged();
  },
});
// Battles (#13) own the whole screen: the map and the lobby's button step
// out while one is open, and the map comes back after.
/** A map-mate's name (a live battle's opponent, #29): the map on screen, else the patch's members. */
const memberName = async (mapId: string, userId: string): Promise<string | null> => {
  const members =
    maps.view?.map.id === mapId ? maps.view.members : (await lobbyApi.get(mapId)).members;
  return members.find((m) => m.user.id === userId)?.user.username ?? null;
};
const battles = createBattleScreen({
  root: document.body,
  // The full-XP reset is the server's time (#583).
  now: () => inventory.gameNow(),
  memberName,
  isGlade: (mapId) => mapId === glade,
  journey: {
    postName: (battleId) => journeys.postFor(battleId)?.name ?? null,
    ended: (battleId, won) => {
      journeys.ended(battleId, won);
      if (won && farHollowSheet.isRoad(battleId)) farHollowArrived = true;
      else if (won && journeys.postFor(battleId) === null) farHollowMaybe = true;
    },
    farHollow: (battleId) => farHollowSheet.isRoad(battleId),
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
  onOpen: (mapId, live) => {
    battleMapId = mapId;
    heartCoins.close();
    // A live battle (#29) keeps following the patch underneath: the other
    // Keeper's picks and cheers arrive on it, and it keeps me "here".
    if (live) maps.hide();
    else maps.close();
    catalog.close();
    roster.close();
    care.close();
    jobs.close();
    void inventory.setMap(null);
    void territory.setMap(null);
    void hollow.setMap(null);
    void land.setMap(null);
    void socialSetMap(null);
    home.setMap(null);
    explore.setMap(null);
    lobby.stepOut();
  },
  onClosed: (mapId) => {
    battleMapId = null;
    evolutionPending = true;
    maps.open(mapId).then(
      () => {
        home.setMap(mapId);
        explore.setMap(mapId);
        // A battle can make a squishy evolve: celebrate it now (#19). A village
        // won in the same battle shows its joy card once that's closed (#592).
        void care.celebrateNews(mapId).finally(() => {
          evolutionPending = false;
          showWonVillages();
          showFarHollowArrival();
        });
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
          socialSetMap(chatFor(mapId)),
        ]);
      },
      (err: unknown) => {
        evolutionPending = false;
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
  onStep: (step, rareFriend) => {
    audio.cue(battleCue(step, rareFriend));
  },
  onRareFind: (scale) => {
    audio.cue(findCue(scale));
  },
});
// Friendly battles (#29): "Who's here now" and "Battle me?" from the Friends
// button beside Chat (top right; the Adventure tray is full on short
// screens); a friend's ask shows over the map. A yes opens the live battle on
// the battle screen for both Keepers.
const friendly = createFriendlyScreen({
  root: document.body,
  entryRoot: trays.slot('top-right'),
  members: (mapId) =>
    maps.view?.map.id === mapId
      ? maps.view.members.map((m) => ({ userId: m.user.id, username: m.user.username }))
      : [],
  openBattle: (battle) => {
    battles.open(battle);
  },
  openTeam: (mapId) => {
    void openTeamPicker(mapId);
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
// A job changed or the board read a fresh view: the home's moods follow (#393).
jobs.onView((mapId, view) => {
  home.setWorkMoods(mapId, workMoods(view));
});
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
    void socialSetMap(null);
    home.setMap(null);
    explore.setMap(null);
    maps.close();
    catalog.close();
    roster.close();
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
    void socialSetMap(null);
    home.setMap(null);
    explore.setMap(null);
    maps.close();
    catalog.close();
    roster.close();
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
  if (house.isOpen) return house.mapId;
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
    void socialSetMap(null);
    home.setMap(null);
    explore.setMap(null);
    maps.close();
    catalog.close();
    roster.close();
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
        void socialSetMap(chatFor(mapId));
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
    void socialSetMap(null);
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
  // Codes' days left count on the bag's game clock (#583).
  now: () => inventory.gameNow(),
  // A patch is on screen (its map, or the home base, close-up or battle over
  // it): looking around goes back to it, with no "Back to my patches" pill (#212).
  patchOpen: () => patchOnScreen() !== null,
  buttonRoot: trays.slot('top-left'),
  // A reload lands back on the last patch (#160), unless a tutorial run
  // going opens the Glade by itself (the same rule the tutorial uses).
  canResume: async () => !opensByItself(await tutorialApi.state()),
  onOpen: async (mapId) => {
    catalog.close();
    roster.close();
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
    void socialSetMap(chatFor(mapId));
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
  mapLines: (mapId) => [heartCoins.lobbyLine(mapId)],
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
// The map's Squishies button leads the round buttons by the Keeper menu
// (before Chat and Friends).
const mapSquishies = squishiesButton(() => {
  if (hudMapId) void roster.open(hudMapId);
}, 'map');
mapSquishies.hidden = true;
trays.slot('top-right').prepend(mapSquishies);

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
    house.isOpen ||
    (wardrobe.debug?.open ?? false) ||
    recipeBook.isOpen ||
    postScreen.isOpen ||
    heartCoins.isOpen ||
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
// The patch line (#391): a patch-mate befriended a Legendary squishy. It waits
// off the map and behind anything else at the top or over the map (a card, a
// sheet, the "What landed" banner, Sprout's hint, another toast); the land
// chip steps aside for it (patch-line.css).
const TOP_NOTES = '.land-toast, .tray-say, .friendly-toast, .wardrobe-toast';
const patchLineBusy = (): boolean =>
  hudMapId === null ||
  battles.debug !== null ||
  whatsNewOpen ||
  raidReportOpen ||
  hollowReportOpen() ||
  trays.debug.hint ||
  trays.debug.open !== null ||
  (maps.debug?.selected ?? null) !== null ||
  inventory.debug?.summary.shown === 'banner' ||
  milestones.debug.showing !== null ||
  lorebook.debug.showing !== null ||
  [...document.querySelectorAll(SHEET_SELECTOR)].some((sheet) => boxOf(sheet) !== null) ||
  [...document.querySelectorAll(TOP_NOTES)].some((note) => boxOf(note) !== null);
const patchLine = createPatchLine({
  root: document.body,
  mapId: () => hudMapId,
  busy: patchLineBusy,
  playerName: (userId) =>
    maps.view?.members.find((m) => m.user.id === userId)?.user.username ?? null,
  kindName: (speciesId) => GAME_DATA.species.find((s) => s.id === speciesId)?.name ?? null,
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
    menuRow('🔒', PRIVACY_TEXT.menuRow, openPrivacy),
  ],
  onChange: (user) => {
    account.setUser(user);
    battles.setUser(user);
    catalog.setUser(user);
    care.setUser(user);
    jobs.setUser(user);
    // Another player's squishies never stay on screen (shared iPads).
    rosterReturn = null;
    roster.close();
    closeUp.setUser(user);
    house.setUser(user);
    inventory.setUser(user);
    recipeBook.setUser(user);
    territory.setUser(user);
    journeys.setUser(user);
    trickOrTreat.setUser(user);
    postScreen.setUser(user);
    hollow.setUser(user);
    land.setUser(user);
    chat.setUser(user);
    friendly.setUser(user);
    home.setUser(user);
    heartCoins.setUser(user);
    explore.setUser(user);
    wardrobe.setUser(user);
    starters.setUser(user);
    lorebook.setUser(user);
    milestones.setUser(user);
    defense.setUser(user);
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
    frameCap: () => stage?.frameCap ?? null,
    testScenes: () => testScenesBuilt,
    hitchesExpected: () => stage?.quality.hitchesExpected ?? 0,
    map: () => maps.debug,
    trays: () => trays.debug,
    recipeBook: () => recipeBook.debug,
    tutorial: () => tutorial.debug,
    updatesHeld: () => updateHold.held,
    battle: () => battles.debug,
    battleDev: () => battles.dev,
    mapDev: () => ({
      select: (q: number, r: number) => maps.focus({ q, r }) !== null,
      show: (q: number, r: number) => {
        const point = maps.focus({ q, r });
        if (point) stage?.camera.panTo(point, true, 0.2);
        return point !== null;
      },
      replay: (event) => {
        maps.replay(event);
      },
    }),
    keeper: () => keeper.debug,
    cinematic: () => cinematic.debug,
    catalog: () => catalog.debug,
    inventory: () => inventory.debug,
    territory: () => territory.debug,
    fences: () => fences.debug,
    tileBuild: () => tileBuild.debug,
    hollow: () => hollow.debug,
    land: () => land.debug,
    chat: () => chat.debug,
    friendly: () => friendly.debug,
    raids: () => raidReport.debug,
    home: () => home.debug,
    explore: () => explore.debug,
    care: () => care.debug,
    closeUp: () => closeUp.debug,
    house: () => house.debug,
    wardrobe: () => wardrobe.debug,
    heartCoins: () => heartCoins.debug,
    jobs: () => jobs.debug,
    roster: () => roster.debug,
    journey: () => journeys.debug,
    farHollow: () => farHollowSheet.debug,
    trickOrTreat: () => trickOrTreat.debug,
    post: () => postScreen.debug,
    communities: () => ({
      flags: communityFlags.shown,
      panel: communityActions.debug,
      restore: restoreSheet.debug,
      keyHunt: keyHunt.debug,
      villages: (maps.view?.communities ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        square: c.square,
        reach: c.reach,
        restored: c.restored,
        ownerUserId: c.ownerUserId,
        cellar: c.cellar ?? null,
      })),
    }),
    posts: () => ({
      shown: postFlags.shown,
      rings: postFlags.rings,
      onScreen: postFlags.onScreen,
      connected: postFlags.connected,
      homes: postFlags.homes,
      boxes: postFlags.boxes,
    }),
    starter: () => starters.debug,
    lore: () => lorebook.debug,
    milestones: () => milestones.debug,
    defense: () => defense.debug,
    whatsNew: () => whatsNew.debug,
    patchLine: () => ({ ...patchLine.debug, busy: patchLineBusy() }),
    audio: () => audio.debug,
  };
}

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas,
  mount: (renderer, target) => {
    stage = mounted(mountStage(renderer, target, sceneBuilder, tier, {}, pinTier));
    shownBuilder = sceneBuilder;
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
}

// The stats badge: dev builds, or `?fps=1` on the live site (#335, the owner's device check).
if (showsStats(import.meta.env.DEV, params)) {
  const { mountDevOverlay } = await import('./engine/dev-overlay.js');
  mountDevOverlay(
    () => stage,
    () => explore.ambient,
  );
}
