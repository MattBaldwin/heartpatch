import {
  buildCost,
  GAME_DATA,
  visualRegistry,
  type FuelAllResponse,
  type HomeResponse,
  type HomeSquishy,
  type KeeperConfig,
  type Building,
  type MyBuilding,
  hexKey,
  type MapView,
  type PublicTile,
  type PublicUser,
  type Species,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import { BUILD_TEXT, pickCard, type BuildCard } from '../building/build-model.js';
import { createBuildSheet } from '../building/build-sheet.js';
import { setPanelFocus } from '../building/panel-focus.js';
import type { BuildSource } from '../building/tile-build.js';
import { FACTORY_TEXT } from '../factory/factory-view.js';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { describeItems } from '../inventory/bag-view.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { TileActions } from '../map/map-screen.js';
import { listenForTaps } from '../map/tap-detector.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { lodFor } from '../procedural/motion.js';
import { el, messageOf } from '../ui/dom.js';
import { rarityDot } from '../ui/rarity/rarity.js';
import { HOME_SHEET, MOOD_CUES, WANDER } from './home-config.js';
import { mapSafeTiles } from './home-layout.js';
import { homeApi, type HomeApi } from './home-api.js';
import { afterHandle, isStrayClick } from './home-peek.js';
import { HomeScene, type HomeSceneStats } from './home-scene.js';
import { createMoodMarks, type MoodMarkLayout } from './mood-marks.js';
import type { WorkMood } from '../squishies/jobs/jobs-view.js';
import {
  atHome,
  buildingIcon,
  buildingName,
  buildingNote,
  buildRows,
  homeBuildReason,
  effectChips,
  costText,
  upgradeOffer,
  upgradeReach,
  HOME_FULL,
  HOME_SAFE_LINE,
  FIRES_ON_LAND,
  freeHomeTiles,
  fuelAllOffer,
  factoryTileOffer,
  groundsTileOffer,
  landTileOffer,
  type GroundsTileOffer,
  BUILDING_DATA,
  likesHabitat,
  refundPreview,
  speciesMap,
  squishyName,
  squishyRarity,
  type HomeSpot,
  type NeedChip,
  type ReachTile,
} from './home-view.js';
import { homeTileLines } from './home-tile-info.js';
import { createHomeNameSheet } from './home-name-sheet.js';
import {
  HOME_NAME_TEXT,
  nameCard,
  nameIdeas,
  isSeedTile,
  nameReady,
  nameRowBadge,
  nameRowParts,
  ringTerrains,
} from './home-name-view.js';
import { HOUSE_TEXT, houseCard } from '../house/house-view.js';
import { resourceCardLines } from '../resource-buildings/resource-card.js';
import {
  RESOURCE_TEXT,
  resourceBuildCards,
  resourceCard,
  resourceHere,
} from '../resource-buildings/resource-model.js';
import './home.css';

// The home base (#18, design doc §13–14): a Home button over the map opens
// the player's seven home tiles up close. They build Hearthfires and
// habitats on the spots there, fuel their fire, and move squishies in; the
// squishies wander about their habitat. Every change is a command the server
// checks (CLAUDE.md rule 1); the screen redraws from its reply.

export interface HomeScreenOptions {
  root: HTMLElement;
  /** Where the entry button goes (a tray over the map, ui/trays); defaults to `root`. */
  entryRoot?: HTMLElement;
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** The player's Keeper, idling by the Heart Seed. */
  keeper: () => KeeperConfig | null;
  /** What the Keeper wears (#43), clothing ids. */
  keeperWearing?: () => readonly string[];
  /** The home opened: the map, the bag and the lobby step out. */
  onOpen: (mapId: string) => void;
  /** Back to the map. */
  onClosed: (mapId: string) => void;
  /** The home couldn't open (offline): say why where the player is looking. */
  onProblem: (message: string) => void;
  /** A squishy itself was tapped: open it up close (#20). */
  onCloseUp?: (mapId: string, squishyId: string) => void;
  /**
   * "Go inside" on the house card, or a tap on the cottage (#381): opens the
   * Keeper's house. Only offered while `HomeResponse.house` is there.
   */
  onHouse?: (mapId: string, home: HomeResponse) => Promise<void>;
  /**
   * "Jobs & team": opens the squishy job board (temporary entry; the trays
   * move it). `at`: Training Grounds on that homestead come first (#277).
   */
  onJobs?: (mapId: string, at?: { q: number; r: number }) => void;
  /** "Open" on my Crafting Factory's tile card (#295): its batches sheet. */
  onOpenFactory?: () => void;
  /** "Collect" on a resource building's tile card (#601 Q3): runs a settle, which banks it. */
  onCollect?: () => Promise<void>;
  /** "Upkeep" on a resource building's tile card (#601 Q5): the Heart Coins sheet's upkeep order. */
  onUpkeep?: () => void;
  /** The game clock in ms (the bag's `gameNow`), for a resource building's next batch. */
  now?: () => number;
  /** Whether "Jobs & team" shows on this map (not on the Tutorial Glade). */
  showJobs?: (mapId: string) => boolean;
  /**
   * Asks for how each of my squishies feels about its job (#393, the jobs
   * view); the moods arrive through `setWorkMoods`, newest only.
   */
  loadWorkMoods?: (mapId: string) => void;
  /** The peek bar's "🐾 Squishies" (#412): opens the Squishies roster (#375). No button without it. */
  onSquishies?: (mapId: string) => void;
  /**
   * Beside the handle, in its row (the 💛 Heart Coin pill, #601), so the
   * peek bar never grows a row (#381). It shows only on the peek bar: the
   * sheet carries `home-sheet-peek`.
   */
  peekCorner?: HTMLElement;
  /**
   * "📖 Recipe book" on a build row short of something you make (the
   * Jack-o'-Lantern). Said just before the home closes: the book opens over
   * the map once it's back, and shutting the book comes home again (#537).
   */
  onRecipeBook?: () => void;
  api?: HomeApi;
  /** The map on screen (#306): its home ring's land gives the name card its ideas. */
  mapView?: () => MapView | null;
  /** The Crafting Factory's tile card (#294, on a homestead since #295). */
  factory?: {
    /** Where Sprout's one-time tip is remembered (null: nowhere). */
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  };
}

type Mode =
  | { readonly kind: 'idle' }
  /** The shared Build sheet (#371): the building picked, and the spot lit and chosen for it. */
  | {
      readonly kind: 'build';
      readonly buildingId: string | null;
      readonly spot: HomeSpot | null;
    }
  | { readonly kind: 'moving'; readonly id: string }
  | { readonly kind: 'selected'; readonly id: string }
  | { readonly kind: 'upgrade'; readonly id: string }
  | { readonly kind: 'confirm-remove'; readonly id: string }
  /** The "Name your home" card (#306 PR 0). */
  | { readonly kind: 'name' };

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface HomeDebug {
  readonly mapId: string;
  readonly open: boolean;
  readonly mode: Mode['kind'];
  readonly items: Readonly<Record<string, number>>;
  readonly buildings: readonly Pick<
    MyBuilding,
    'id' | 'buildingId' | 'q' | 'r' | 'spot' | 'lit' | 'nightsLeft' | 'residents'
  >[];
  readonly squishies: number;
  readonly scene: HomeSceneStats | null;
  /** Wander hops started since the home opened. */
  readonly hops: number;
  /** The mood cues (#393): `bounce` while happy squishies may hop, else `static`. */
  readonly moodCues: 'bounce' | 'static';
  /** Mood bubbles on screen now, by mood (#393). */
  readonly moodMarks: Readonly<Record<WorkMood, number>>;
  /** Where each bubble went and why (#393, mood-layout.ts). */
  readonly moodLayout: readonly MoodMarkLayout[];
  /** The main view's sheet (#412): the short peek bar, or opened into the full lists. */
  readonly sheet: 'peek' | 'open';
}

export interface HomeScreen {
  /** The map on screen (null: none): shows the Home button. */
  setMap: (mapId: string | null) => void;
  setUser: (user: PublicUser | null) => void;
  /** Opens the home base of the map on screen. */
  open: () => Promise<void>;
  /** Tile-panel lines and the "Go home" button for home tiles. */
  readonly tileActions: TileActions;
  /** Fires, lanterns and Training Grounds the shared Build sheet can put up on my land (#371). */
  readonly buildSource: BuildSource;
  /** My newest jobs view's moods for a map (#393), from the jobs feed: the only way moods reach the home. */
  setWorkMoods: (mapId: string, moods: ReadonlyMap<string, WorkMood>) => void;
  readonly debug: HomeDebug | null;
}

// Player-facing text (style guide §6, §9).
export const HOME_TEXT = {
  home: 'Home',
  title: 'Your home base',
  build: 'Build',
  back: 'Back to map',
  pick: 'Tap a glowing tile!',
  anywhere: 'Put it anywhere',
  cancel: 'Cancel',
  move: 'Move',
  takeDown: 'Take down',
  done: 'Done',
  addFuel: 'Add fuel',
  moveIn: 'Move in',
  moveOut: 'Move out',
  upgrade: '⬆️ Upgrade',
  upgradeNow: 'Upgrade!',
  notNow: 'Not now',
  ready: 'Ready!',
  level: (n: number) => `Level ${String(n)}`,
  levels: (from: number, to: number) => `Level ${String(from)} → ${String(to)}`,
  youNeed: 'You need',
  upgraded: (name: string, level: number) => `Ta-da! Your ${name} is now level ${String(level)}!`,
  recipeBook: '📖 Recipe book',
  reachNow: 'Your home: safe now',
  reachNew: 'Safe after this',
  reachOut: 'Still outside',
  reachLabel: 'Your home and the land around it. The new tiles turn safe after the upgrade.',
  livesHere: 'Lives here',
  cozy: 'Loves it here!',
  full: 'Full',
  yours: 'Your buildings',
  jobs: '🧺 Jobs & team',
  /** The peek bar's button to the squishies (#412; 🐾 as the Squishies roster, #375). */
  squishies: '🐾 Squishies',
  /** The sheet handle, for VoiceOver (#412). */
  showMore: 'Show more',
  /** The handle's own words (#433): it opens to your buildings, or folds back. */
  showLess: 'Show less',
  more: 'More',
  less: 'Less',
  none: 'Nothing built yet. Tap Build!',
  noSquishies: 'No squishies yet. Befriend one on the map!',
  confirm: (name: string, back: string) =>
    back ? `Take down the ${name}? You get back ${back}.` : `Take down the ${name}?`,
  keep: 'Keep it',
  yes: 'Yes, take it down',
  built: (name: string) => `Ta-da! Your ${name} is ready.`,
  fuelled: 'Crackle crackle! The fire is cozy and warm.',
  moved: 'All moved!',
  removed: (back: string) => (back ? `Taken down. You got back ${back}.` : 'Taken down.'),
  movedIn: (name: string, where: string) => `${name} moved into the ${where}!`,
  movedOut: (name: string) => `${name} moved out.`,
  goHome: 'Go home',
  // Fires on my land (#202).
  landFires: (n: number, low: number) =>
    `🔥 ${String(n)} ${n === 1 ? 'fire' : 'fires'} on your land.` +
    (low === 0 ? '' : low === 1 ? ' 1 is almost out!' : ` ${String(low)} are almost out!`),
  fuelAll: (cost: string) => `🔥 Fuel all fires (${cost})`,
  allFull: 'All your fires are full! 🔥',
  fuelledAll: (n: number, nights: number) =>
    `Ta-da! All ${String(n)} fires are full for ${String(nights)} ${nights === 1 ? 'night' : 'nights'}. 🔥`,
  fuelledSome: (n: number) =>
    `Your bag ran out! ${String(n)} ${n === 1 ? 'fire' : 'fires'} got more. The lowest went first. 🔥`,
  fireBuilt: 'Ta-da! Your fire is built. Add Emberwood to light it!',
  landFuel: '🔥 Add fuel',
  // Training Grounds on a homestead (#277, mockup screen 6).
  groundsBuilt: 'Ta-da! Your Training Grounds are ready. Send someone to practice!',
  trainHere: '🎯 Train here',
  factoryBuilt: 'Ta-da! Your Crafting Factory is up. Tap Open to start a batch!',
  openFactory: '🏭 Open',
  factoryLose:
    'If you lose this land, everything it cost and everything in its batches comes back.',
  groundsLit: '🔥 In fire light',
  groundsDark: '🌙 Dark at night',
  groundsNight:
    "Trainees sleep here at night. Keep a fire nearby so the Hollow Man can't reach them!",
  groundsLose: 'If you lose this land, the Training Grounds come down and you get half back.',
  groundsNapping: 'zZ This homestead is napping, so practice stops until it joins home again.',
} as const;

/** One night of fuel per tap: easy to count, quick to top up. */
const FUEL_NIGHTS = 1;
/** Where Sprout remembers it gave the Factory tip (#294), per account. */
const FACTORY_TIP_KEY = (userId: string) => `heartpatch.factory.tip.${userId}`;

export function createHomeScreen(options: HomeScreenOptions): HomeScreen {
  const api = options.api ?? homeApi;
  const registry = visualRegistry(GAME_DATA);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let home: HomeResponse | null = null;
  let isOpen = false;
  let mode: Mode = { kind: 'idle' };
  /** The main view's sheet is opened into the full lists (#412); it starts as the peek bar. */
  let sheetOpen = false;
  let working = false;
  /** The house is opening (#381): its card and shortcut wait, so a double tap opens it once. */
  let houseOpening = false;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let scene3d: HomeScene | null = null;
  let wanderTimer: number | undefined;
  let frame = 0;
  let wanderTurn = 0;
  /** Wander beats so far; every `MOOD_CUES.cheerEvery`-th one, a happy squishy bounces (#393). */
  let beats = 0;
  let cheerTurn = 0;
  /** My squishies' work moods (#393) and the map they're for. */
  let moods: { mapId: string; moods: ReadonlyMap<string, WorkMood> } | null = null;
  let lastTier: QualityTier | null = null;
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  /** The name card's refusal (the server's words, or the name rules'), shown in the card. */
  let nameError: string | null = null;
  /** My home ring's terrains, read from the map as home opens (the name card's ideas). */
  let ringLand: string[] = [];
  const nameSheet = createHomeNameSheet();

  // ── Sprout's Factory tip (#294) ───────────────────────────────────────
  const tipStorage =
    options.factory?.storage === undefined ? safeStorage() : options.factory.storage;
  /** The Factory card showing Sprout's one-time tip (#294), or null. */
  let tipFor: string | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────
  const entry = el(
    'button',
    {
      type: 'button',
      class: 'home-open',
      'data-testid': 'home-open',
      'aria-label': HOME_TEXT.home,
    },
    el('span', { class: 'home-open-icon', 'aria-hidden': 'true' }, '🏡'),
    el('span', { class: 'home-open-label' }, HOME_TEXT.home),
  );
  entry.hidden = true;
  entry.addEventListener('click', () => {
    void open();
  });

  const status = el('p', { class: 'home-fire', 'data-testid': 'home-fire' });
  // Fires out on my land and "Fuel all fires" (#202), under the home fire's line.
  const landLine = el('p', { class: 'home-land-fires', 'data-testid': 'home-land-fires' });
  const fuelAllBox = el('div', { class: 'home-row home-fuel-all' });
  const top = el(
    'header',
    { class: 'home-top' },
    el('h2', { class: 'home-title', id: 'home-title' }, HOME_TEXT.title),
    status,
    landLine,
    fuelAllBox,
  );
  const note = el('p', { class: 'home-note', role: 'status', 'data-testid': 'home-note' });
  const body = el('div', { class: 'home-body', id: 'home-body' });
  const homeSheet = createBuildSheet();
  // The sheet's handle (#412), at the very top of the main view's sheet: a
  // tap opens or folds it, a swipe goes the finger's way. A finger or mouse
  // decides on release (held by pointer capture, so a drag that ends off the
  // handle still counts) and the click after it is swallowed; a click with no
  // press before it (keyboard, VoiceOver) toggles.
  const handle = el('button', {
    type: 'button',
    class: 'home-handle',
    'data-testid': 'home-handle',
    // The disclosure it opens and folds (#433).
    'aria-controls': 'home-body',
  });
  // Its word, next to the grip, so the way to your buildings is visible (#433).
  const handleWord = el('span', { class: 'home-handle-word', 'aria-hidden': 'true' });
  // A small badge when naming is ready, only on the peek bar (#381: it never grows a row).
  const handleNudge = el('span', {
    class: 'home-handle-nudge',
    'data-testid': 'home-handle-nudge',
  });
  handleNudge.hidden = true;
  handle.append(handleWord, handleNudge);
  let pressY: number | null = null;
  let releasedAt = -Infinity;
  /** Where the handle was let go, until the click that tap makes has come (or not). */
  let strayClick: { x: number; y: number } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    pressY = e.clientY;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already-released pointer can't be captured; harmless.
    }
  });
  handle.addEventListener('pointerup', (e) => {
    if (pressY === null) return;
    const dy = e.clientY - pressY;
    pressY = null;
    releasedAt = performance.now();
    strayClick = { x: e.clientX, y: e.clientY };
    setSheet(afterHandle(sheetOpen, dy, HOME_SHEET.swipePx));
  });
  handle.addEventListener('pointercancel', () => {
    pressY = null;
  });
  handle.addEventListener('click', () => {
    if (performance.now() - releasedAt < HOME_SHEET.clickAfterMs) return;
    setSheet(!sheetOpen);
  });
  const sheet = el(
    'section',
    { class: 'home-sheet', 'data-testid': 'home', role: 'dialog', 'aria-labelledby': 'home-title' },
    options.peekCorner
      ? el('div', { class: 'home-handle-row' }, options.peekCorner, handle)
      : handle,
    note,
    body,
  );
  // A tap on the handle opens or folds the sheet on release, and the rows
  // move. On iPad Safari the tap's click comes after that, where the finger
  // was, so it would press whatever row moved under it (Jobs & team, #306):
  // that one click is swallowed too, before it reaches the row. A tap
  // anywhere else, however quick, still counts.
  sheet.addEventListener(
    'click',
    (e) => {
      const at = strayClick;
      strayClick = null;
      const click = { x: e.clientX, y: e.clientY };
      if (!isStrayClick(at, click, performance.now() - releasedAt, HOME_SHEET)) return;
      if (e.target instanceof Node && handle.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  const overlay = el('div', { class: 'home' }, top, sheet);
  overlay.hidden = true;
  (options.entryRoot ?? options.root).append(entry);
  options.root.append(overlay);

  const say = (text: string) => {
    note.textContent = text;
  };

  function setSheet(open: boolean): void {
    if (open === sheetOpen) return;
    sheetOpen = open;
    render();
    body.scrollTop = 0;
    sheet.scrollTop = 0;
  }

  const button = (
    label: string,
    onTap: () => void,
    extra: Record<string, string> = {},
    soft = false,
  ) => {
    const { class: more = '', ...attrs } = extra;
    const b = el(
      'button',
      {
        type: 'button',
        class: `auth-button home-button${soft ? ' auth-button-soft' : ''} ${more}`.trim(),
        ...attrs,
      },
      label,
    );
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  // ── Server calls ──────────────────────────────────────────────────────
  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    try {
      const fresh = await api.get(id);
      if (at !== generation) return;
      show(fresh);
    } catch (err) {
      if (at === generation) say(messageOf(err));
    }
  }

  /**
   * Runs one command for the home on screen, one at a time. A `CONFLICT`
   * (the spot was taken, the bag changed) refetches, so the screen matches
   * the server again.
   */
  async function act(
    run: (
      mapId: string,
      send: <T>(command: (key: string) => Promise<T>) => Promise<T | null>,
    ) => Promise<HomeResponse | null>,
    done: (next: HomeResponse) => { mode: Mode; say: string },
    /** Where a refusal shows (default: the sheet's note). */
    failed: (message: string) => void = say,
  ): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    working = true;
    render();
    try {
      const next = await run(id, (command) =>
        sendCommand(sendDeps, command, () => at === generation),
      );
      if (!next || at !== generation) return;
      const after = done(next);
      mode = after.mode;
      show(next);
      say(after.say);
    } catch (err) {
      if (at === generation) {
        failed(messageOf(err));
        if (err instanceof ApiRequestError && err.code === 'CONFLICT') await refresh();
      }
    } finally {
      working = false;
      if (at === generation) render();
    }
  }

  const place = (buildingId: string, spot: HomeSpot) =>
    act(
      (id, send) => send((key) => api.place(id, { buildingId, ...spot }, key)),
      (next) => {
        const built = next.buildings.find(
          (b) => b.q === spot.q && b.r === spot.r && b.spot === spot.spot,
        );
        return {
          mode: built ? { kind: 'selected', id: built.id } : { kind: 'idle' },
          say: HOME_TEXT.built(buildingName(buildingId)),
        };
      },
    );

  const move = (buildingId: string, spot: HomeSpot) =>
    act(
      (id, send) => send((key) => api.move(id, buildingId, spot, key)),
      () => ({ mode: { kind: 'selected', id: buildingId }, say: HOME_TEXT.moved }),
    );

  const fuel = (buildingId: string) =>
    act(
      (id, send) => send((key) => api.fuel(id, buildingId, FUEL_NIGHTS, key)),
      () => ({ mode: { kind: 'selected', id: buildingId }, say: HOME_TEXT.fuelled }),
    );

  /** "Fuel all fires" (#202): every fire, lowest first, until full or the bag runs out. */
  const fuelAll = () => {
    let result: FuelAllResponse | null = null;
    return act(
      async (id, send) => {
        result = await send((key) => api.fuelAll(id, key));
        return result?.home ?? null;
      },
      () => {
        const done: FuelAllResponse | null = result;
        // How full "full" is comes from the server's reply (fuel nights are tunable data).
        const fires = done?.home.buildings.filter((b) => b.kind === 'hearthfire') ?? [];
        return {
          mode: { kind: 'idle' },
          say: done?.short
            ? HOME_TEXT.fuelledSome(done.fires)
            : HOME_TEXT.fuelledAll(
                fires.length,
                Math.max(0, ...fires.map((b) => b.nightsLeft ?? 0)),
              ),
        };
      },
    );
  };

  const upgrade = (buildingId: string) =>
    act(
      (id, send) => send((key) => api.upgrade(id, buildingId, key)),
      (next) => {
        const b = next.buildings.find((x) => x.id === buildingId);
        return {
          mode: { kind: 'selected', id: buildingId },
          say: HOME_TEXT.upgraded(buildingName(b?.buildingId ?? ''), b?.level ?? 1),
        };
      },
    );

  const remove = (buildingId: string) => {
    let back = '';
    return act(
      async (id, send) => {
        const res = await send((key) => api.remove(id, buildingId, key));
        if (!res) return null;
        back = describeItems(res.refund);
        return res.home;
      },
      () => ({ mode: { kind: 'idle' }, say: HOME_TEXT.removed(back) }),
    );
  };

  /** "Name it!" (#306 PR 0): a refusal (locked, not grown yet, the filter) shows in the card. */
  const nameHome = (name: string) => {
    nameError = null;
    return act(
      (id, send) => send((key) => api.name(id, name, key)),
      (next) => ({
        mode: { kind: 'idle' },
        say: HOME_NAME_TEXT.named(next.naming?.name ?? name),
      }),
      (message) => {
        nameError = message;
      },
    );
  };

  /** Opens the name card, its field holding my name (or the first idea). */
  const openName = (current: HomeResponse) => {
    nameError = null;
    nameSheet.reset(current.naming?.name ?? ideasFor()[0] ?? '');
    setMode({ kind: 'name' });
  };

  const ideasFor = () => {
    const live = ringTerrains(options.mapView?.() ?? null, user?.id ?? null);
    return nameIdeas(user?.username ?? null, live.length > 0 ? live : ringLand);
  };

  /**
   * The home sheet's "Name your home" row (#306 PR 0), above the Build row
   * of the opened sheet (the peek bar never grows a row, #381): only with a
   * gate from the server.
   */
  const nameRow = (current: HomeResponse): Node[] => {
    const naming = current.naming;
    if (!naming) return [];
    const parts = nameRowParts(naming);
    const b = button(
      parts.title,
      () => {
        openName(current);
      },
      { 'data-testid': 'home-name-row', class: 'home-name-row' },
      true,
    );
    if (parts.detail) b.append(el('span', { class: 'home-name-detail' }, parts.detail));
    const badge = nameRowBadge(naming);
    if (badge) b.append(el('span', { class: 'home-name-badge' }, badge));
    return [el('div', { class: 'home-row' }, b)];
  };

  const house = (squishyId: string, habitatId: string | null, name: string, where: string) =>
    act(
      (id, send) => send((key) => api.house(id, squishyId, habitatId, key)),
      () => ({
        mode,
        say: habitatId ? HOME_TEXT.movedIn(name, where) : HOME_TEXT.movedOut(name),
      }),
    );

  /** A spot was tapped (or "Put it anywhere"): picked for the Build sheet, or moved to. */
  const chooseSpot = (spot: HomeSpot) => {
    if (mode.kind === 'build') setMode({ ...mode, spot });
    else if (mode.kind === 'moving') void move(mode.id, spot);
  };

  /**
   * The Build sheet at home (#371): a card for each building I could put up,
   * the one picked, the spots it could go on (lit), and the spot chosen
   * (the first until a tap says otherwise).
   */
  const buildView = (current: HomeResponse) => {
    const all = buildRows(current);
    // Home buildings at their cap, and ones with no free tile, have no card:
    // the line on top says why nothing more goes up (#537), once.
    const reason = homeBuildReason(current, all);
    const rows = all.filter(
      (r) =>
        r.option.kind !== 'built' && !(r.option.kind === 'blocked' && r.option.note === HOME_FULL),
    );
    const cards: BuildCard[] = rows.map((r) => ({
      id: r.building.id,
      icon: r.icon,
      name: r.building.name,
      effect: r.effects[0] ?? r.description,
      cost: buildCost(r.building),
      area: 'spot',
      blocked: r.option.kind === 'blocked' ? r.option.note : null,
      craft: r.option.kind === 'craft' ? r.option.note : null,
    }));
    const card = pickCard(cards, mode.kind === 'build' ? mode.buildingId : null, current.items);
    const row = rows.find((r) => r.building.id === card?.id);
    // A blocked card (out of season, no room) shows why, with no spots lit.
    const spots =
      row && row.option.kind !== 'blocked'
        ? freeHomeTiles(atHome(current), null, row.building.slot)
        : [];
    const wanted = mode.kind === 'build' ? mode.spot : null;
    const spot =
      spots.find((s) => s.q === wanted?.q && s.r === wanted.r && s.spot === wanted.spot) ??
      spots[0] ??
      null;
    return { cards, card, spots, spot, reason };
  };

  // ── Drawing ───────────────────────────────────────────────────────────

  /** The spots to light up for the current mode. */
  const spotsFor = (current: HomeResponse): HomeSpot[] => {
    const m = mode;
    const home = atHome(current);
    if (m.kind === 'build') return buildView(current).spots;
    if (m.kind === 'moving') {
      const moving = home.buildings.find((b) => b.id === m.id);
      const slot = BUILDING_DATA.get(moving?.buildingId ?? '')?.slot;
      // One entry a tile, so its own tile is out whatever spot it stands on.
      return freeHomeTiles(home, m.id, slot).filter(
        (s) => !(moving && s.q === moving.q && s.r === moving.r),
      );
    }
    return [];
  };

  function show(next: HomeResponse): void {
    home = next;
    // A building that's gone can't stay selected.
    const m = mode;
    if ('id' in m && !next.buildings.some((b) => b.id === m.id)) mode = { kind: 'idle' };
    // The home scene draws the home base; fires out on my land are on the map.
    scene3d?.update(atHome(next));
    syncScene();
    render();
    syncWander();
  }

  function syncScene(): void {
    if (!scene3d || !home) return;
    scene3d.showSpots(spotsFor(home));
    scene3d.select('id' in mode && mode.kind !== 'moving' ? mode.id : null);
    // The spot a building will go on, ringed among the glowing ones (#371).
    if (mode.kind === 'build') scene3d.markSpot(buildView(home).spot);
    options.invalidate();
  }

  const setMode = (next: Mode) => {
    mode = next;
    say('');
    syncScene();
    render();
  };

  function render(): void {
    entry.hidden = mapId === null || isOpen;
    overlay.hidden = !isOpen;
    if (!isOpen || !home) {
      body.replaceChildren();
      return;
    }
    const current = home;
    const peek = mode.kind === 'idle' && !sheetOpen;
    sheet.classList.toggle('home-sheet-peek', peek);
    handle.hidden = mode.kind !== 'idle';
    sheet.classList.toggle('home-sheet-name', mode.kind === 'name');
    status.textContent = HOME_SAFE_LINE;
    renderFuelAll(current);
    const row = (...children: Node[]) => el('div', { class: 'home-row' }, ...children);

    switch (mode.kind) {
      case 'idle': {
        handle.setAttribute('aria-expanded', String(sheetOpen));
        const nudge = !sheetOpen && nameReady(current.naming);
        handleNudge.hidden = !nudge;
        handleNudge.textContent = nudge ? HOME_NAME_TEXT.handleNudge : '';
        handle.setAttribute(
          'aria-label',
          sheetOpen
            ? HOME_TEXT.showLess
            : nudge
              ? `${HOME_TEXT.showMore}. ${HOME_NAME_TEXT.handleNudgeLabel}`
              : HOME_TEXT.showMore,
        );
        handleWord.textContent = sheetOpen ? `${HOME_TEXT.less} ▾` : `${HOME_TEXT.more} ▴`;
        const chips = atHome(current).buildings.map((b) =>
          button(
            `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}`,
            () => {
              setMode({ kind: 'selected', id: b.id });
            },
            { 'data-building': b.id, class: 'home-chip' },
            true,
          ),
        );
        const jobs =
          current.squishies.length > 0 &&
          options.onJobs &&
          mapId &&
          options.showJobs?.(mapId) !== false
            ? button(
                HOME_TEXT.jobs,
                () => {
                  if (mapId) options.onJobs?.(mapId);
                },
                { 'data-testid': 'home-jobs' },
                peek,
              )
            : null;
        const actions = row(
          button(
            HOME_TEXT.build,
            () => {
              setMode({ kind: 'build', buildingId: null, spot: null });
            },
            { 'data-testid': 'home-build' },
          ),
          button(HOME_TEXT.back, close, { 'data-testid': 'home-back' }, true),
        );
        if (peek) {
          // The peek bar (#412): the squishies stay in view above it.
          const squishies =
            current.squishies.length > 0 && options.onSquishies && mapId
              ? button(
                  HOME_TEXT.squishies,
                  () => {
                    if (mapId) options.onSquishies?.(mapId);
                  },
                  { 'data-testid': 'home-squishies' },
                  true,
                )
              : null;
          const shortcuts = [squishies, jobs].filter((b) => b !== null);
          // The house's round 🏠 rides the Build row, so the peek bar never grows a row (#381).
          const house = houseShortcut(current);
          if (house) actions.prepend(house);
          body.replaceChildren(
            ...(shortcuts.length > 0
              ? [el('div', { class: 'home-row home-row-wrap home-peek-row' }, ...shortcuts)]
              : []),
            actions,
          );
          break;
        }
        body.replaceChildren(
          el('h3', { class: 'home-section-title' }, HOME_TEXT.yours),
          chips.length > 0
            ? el('div', { class: 'home-chips' }, ...chips)
            : el('p', { class: 'home-empty' }, HOME_TEXT.none),
          ...houseCardNodes(current),
          // Your squishies live in the Squishies roster (#375): 🐾 at the top,
          // or the peek bar's Squishies.
          ...(jobs ? [row(jobs)] : []),
          ...nameRow(current),
          actions,
        );
        break;
      }
      case 'build': {
        const view = buildView(current);
        homeSheet.update({
          cards: view.cards,
          selectedId: view.card?.id ?? null,
          bag: current.items,
          areas: view.spot ? 1 : 0,
          hint:
            view.reason ??
            (view.spots.length === 0 ? '' : mode.spot ? BUILD_TEXT.tileChosen : BUILD_TEXT.tapTile),
          allEdges: null,
          working,
          // Fires have no card here: one line says they go out on my land.
          note: FIRES_ON_LAND,
          onSelect: (id) => {
            setMode({ kind: 'build', buildingId: id, spot: null });
          },
          onAllEdges: () => undefined,
          onBuild: () => {
            if (view.card && view.spot) void place(view.card.id, view.spot);
          },
          onCancel: () => {
            setMode({ kind: 'idle' });
          },
          onRecipeBook: options.onRecipeBook
            ? () => {
                options.onRecipeBook?.();
                close();
              }
            : undefined,
        });
        if (homeSheet.element.parentElement !== body) body.replaceChildren(homeSheet.element);
        break;
      }
      case 'name': {
        const naming = current.naming;
        if (!naming) {
          mode = { kind: 'idle' };
          render();
          return;
        }
        nameSheet.update({
          naming,
          ideas: nameCard(naming) === 'name' ? ideasFor() : [],
          working,
          error: nameError,
          onName: (name) => void nameHome(name),
          onInvalid: (message) => {
            nameError = message;
            render();
          },
          onClose: () => {
            setMode({ kind: 'idle' });
          },
        });
        if (nameSheet.element.parentElement !== body) body.replaceChildren(nameSheet.element);
        break;
      }
      case 'moving': {
        const movingId = mode.id;
        const spots = spotsFor(current);
        const first = spots[0];
        body.replaceChildren(
          el('p', { class: 'home-pick' }, HOME_TEXT.pick),
          row(
            button(
              HOME_TEXT.anywhere,
              () => {
                if (first) chooseSpot(first);
              },
              { 'data-testid': 'home-anywhere' },
            ),
            button(
              HOME_TEXT.cancel,
              () => {
                setMode({ kind: 'selected', id: movingId });
              },
              {},
              true,
            ),
          ),
        );
        break;
      }
      case 'selected': {
        const { id } = mode;
        const b = current.buildings.find((x) => x.id === id);
        if (!b) break;
        body.replaceChildren(...buildingCard(current, b));
        break;
      }
      case 'upgrade': {
        const { id } = mode;
        const b = current.buildings.find((x) => x.id === id);
        const offer = b ? upgradeOffer(current, b) : null;
        if (!b || !offer) break;
        const reach =
          offer.radius !== null && b.kind === 'hearthfire'
            ? [reachMap(upgradeReach(current, b, offer.radius))]
            : [];
        const go = button(HOME_TEXT.upgradeNow, () => void upgrade(b.id), {
          'data-testid': 'home-upgrade-confirm',
          class: 'home-grow',
        });
        if (!offer.affordable) go.disabled = true;
        body.replaceChildren(
          el(
            'div',
            { class: 'home-card-head' },
            el('h3', { class: 'home-section-title' }, `⬆️ ${buildingName(b.buildingId)}`),
            el('span', { class: 'home-level' }, HOME_TEXT.levels(offer.from, offer.to)),
          ),
          el('p', { class: 'home-card-note', 'data-testid': 'home-upgrade-line' }, offer.line),
          ...reach,
          el('p', { class: 'home-need-title' }, HOME_TEXT.youNeed),
          needRow(offer.needs),
          ...(offer.next ? [el('p', { class: 'home-next' }, offer.next)] : []),
          row(
            go,
            button(
              HOME_TEXT.notNow,
              () => {
                setMode({ kind: 'selected', id: b.id });
              },
              {},
              true,
            ),
          ),
        );
        break;
      }
      case 'confirm-remove': {
        const { id } = mode;
        const b = current.buildings.find((x) => x.id === id);
        if (!b) break;
        const back = costText(refundPreview(b));
        body.replaceChildren(
          el('p', { class: 'home-pick' }, HOME_TEXT.confirm(buildingName(b.buildingId), back)),
          row(
            button(HOME_TEXT.yes, () => void remove(b.id), {
              'data-testid': 'home-confirm-remove',
            }),
            button(
              HOME_TEXT.keep,
              () => {
                setMode({ kind: 'selected', id: b.id });
              },
              {},
              true,
            ),
          ),
        );
        break;
      }
    }
  }

  /** The Keeper's house card (#381): only while the house is on for this player. */
  function houseCardNodes(current: HomeResponse): Node[] {
    const card = houseCard(current);
    if (!card || !options.onHouse) return [];
    return [
      el(
        'div',
        { class: 'home-house', 'data-testid': 'home-house' },
        el(
          'span',
          { class: 'home-house-text' },
          el('span', { class: 'home-house-title' }, card.title),
          el('span', { class: 'home-house-line' }, card.line),
        ),
        (() => {
          const b = button(HOUSE_TEXT.goInside, goInside, { 'data-testid': 'home-house-open' });
          b.disabled = working || houseOpening;
          return b;
        })(),
      ),
    ];
  }

  /** The peek bar's way into the house (#381), in the Build row: only while the house is on. */
  function houseShortcut(current: HomeResponse): HTMLButtonElement | null {
    if (!houseCard(current) || !options.onHouse) return null;
    // A round icon button, so the Build row (and the peek bar) stays one row.
    const b = button(
      HOUSE_TEXT.shortcutIcon,
      goInside,
      {
        'data-testid': 'home-house-shortcut',
        class: 'home-house-shortcut',
        'aria-label': HOUSE_TEXT.shortcut,
        title: HOUSE_TEXT.shortcut,
      },
      true,
    );
    b.disabled = working || houseOpening;
    return b;
  }

  /** Opens the house, once: the card and the shortcut wait while it loads. */
  function goInside(): void {
    const current = home;
    const id = mapId;
    if (!id || !current?.house || working || houseOpening || !options.onHouse) return;
    houseOpening = true;
    render();
    void options.onHouse(id, current).finally(() => {
      houseOpening = false;
      if (isOpen) render();
    });
  }

  /** The home's top card: how many fires are out on my land, and "Fuel all fires" (#202). */
  function renderFuelAll(current: HomeResponse): void {
    const offer = mode.kind === 'idle' ? fuelAllOffer(current) : null;
    landLine.hidden = offer === null;
    fuelAllBox.hidden = offer === null;
    if (!offer) {
      fuelAllBox.replaceChildren();
      return;
    }
    landLine.textContent = offer.full
      ? HOME_TEXT.allFull
      : HOME_TEXT.landFires(offer.land, offer.low);
    if (offer.full) {
      fuelAllBox.replaceChildren();
      return;
    }
    fuelAllBox.replaceChildren(
      button(HOME_TEXT.fuelAll(costText(offer.cost)), () => void fuelAll(), {
        'data-testid': 'home-fuel-all',
      }),
    );
  }

  function buildingCard(current: HomeResponse, b: MyBuilding): Node[] {
    const card: Node[] = [
      el(
        'div',
        { class: 'home-card-head' },
        el(
          'h3',
          { class: 'home-section-title' },
          `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}`,
        ),
        el('span', { class: 'home-level' }, HOME_TEXT.level(b.level)),
      ),
      el('p', { class: 'home-card-note', 'data-testid': 'home-card-note' }, buildingNote(b)),
    ];
    const actions: Node[] = [];
    const offer = upgradeOffer(current, b);
    if (offer) {
      const up = button(
        HOME_TEXT.upgrade,
        () => {
          setMode({ kind: 'upgrade', id: b.id });
        },
        { 'data-testid': 'home-upgrade' },
      );
      if (offer.affordable) up.append(el('span', { class: 'home-ready' }, HOME_TEXT.ready));
      actions.push(up);
    }
    if (b.kind === 'hearthfire') {
      const data = GAME_DATA.buildings.find((x) => x.id === b.buildingId);
      const cost =
        data?.kind === 'hearthfire'
          ? costText({ [data.fuelResource]: data.fuelPerNight * FUEL_NIGHTS })
          : '';
      const fuelButton = button(`${HOME_TEXT.addFuel} (${cost})`, () => void fuel(b.id), {
        'data-testid': 'home-fuel',
      });
      if ((b.fuelSpace ?? 0) === 0) fuelButton.disabled = true;
      actions.push(fuelButton);
    }
    if (b.kind === 'habitat') {
      const species = speciesMap(current);
      const full = (b.residents ?? 0) >= (b.capacity ?? 0);
      const where = buildingName(b.buildingId);
      card.push(
        current.squishies.length === 0
          ? el('p', { class: 'home-empty' }, HOME_TEXT.noSquishies)
          : el(
              'ul',
              { class: 'home-list', 'data-testid': 'home-residents' },
              ...current.squishies.map((s) => {
                const name = squishyName(s, species);
                const here = s.habitatId === b.id;
                const action = here
                  ? button(
                      HOME_TEXT.moveOut,
                      () => void house(s.id, null, name, where),
                      {
                        'data-squishy': s.id,
                      },
                      true,
                    )
                  : full
                    ? el('span', { class: 'home-list-note' }, HOME_TEXT.full)
                    : button(HOME_TEXT.moveIn, () => void house(s.id, b.id, name, where), {
                        'data-squishy': s.id,
                      });
                return el(
                  'li',
                  { class: 'home-list-row' },
                  el(
                    'span',
                    { class: 'home-list-name' },
                    squishyTitle(s, name, species),
                    el(
                      'span',
                      { class: 'home-list-sub' },
                      here
                        ? HOME_TEXT.livesHere
                        : likesHabitat(s, b.buildingId)
                          ? HOME_TEXT.cozy
                          : '',
                    ),
                  ),
                  action,
                );
              }),
            ),
      );
    }
    actions.push(
      button(
        HOME_TEXT.move,
        () => {
          setMode({ kind: 'moving', id: b.id });
        },
        {},
        true,
      ),
      button(
        HOME_TEXT.takeDown,
        () => {
          setMode({ kind: 'confirm-remove', id: b.id });
        },
        {
          'data-testid': 'home-remove',
        },
        true,
      ),
    );
    card.push(
      el('div', { class: 'home-row home-row-wrap' }, ...actions),
      el(
        'div',
        { class: 'home-row' },
        button(
          HOME_TEXT.done,
          () => {
            setMode({ kind: 'idle' });
          },
          { 'data-testid': 'home-done' },
          true,
        ),
      ),
    );
    return card;
  }

  /** Sprout's tip the first time a kid sees their Factory (#294, owner decision 2026-10-08). */
  function factoryTip(buildingRowId: string): Node[] {
    if (!user || !tipStorage) return [];
    if (tipFor !== buildingRowId) {
      const key = FACTORY_TIP_KEY(user.id);
      try {
        if (tipStorage.getItem(key) !== null) return [];
        tipStorage.setItem(key, '1');
      } catch {
        return [];
      }
      // Stays up while this card is open, however often it redraws.
      tipFor = buildingRowId;
    }
    return [
      el(
        'p',
        { class: 'home-sprout-tip', 'data-testid': 'factory-tip' },
        el('span', { 'aria-hidden': 'true' }, '🌱 '),
        FACTORY_TEXT.sproutTip,
      ),
    ];
  }

  /** Have/need chips ("🪵 12/10 ✓"), green when there's enough. */
  function needRow(needs: readonly NeedChip[]): HTMLElement {
    return el(
      'span',
      { class: 'home-needs' },
      ...needs.map((n) =>
        el(
          'span',
          {
            class: `home-need${n.ok ? ' home-need-ok' : ''}`,
            'aria-label': `${n.name}: ${String(n.have)} of ${String(n.need)}`,
          },
          n.ok ? `${n.label} ✓` : n.label,
        ),
      ),
    );
  }

  /** The upgrade sheet's little map: where the fire's light reaches now and after. */
  function reachMap(tiles: readonly ReachTile[]): HTMLElement {
    const NS = 'http://www.w3.org/2000/svg';
    const size = 20;
    const svg = document.createElementNS(NS, 'svg');
    const pos = tiles.map((t) => ({
      t,
      x: size * Math.sqrt(3) * (t.q + t.r / 2),
      y: size * 1.5 * t.r,
    }));
    const xs = pos.map((p) => p.x);
    const ys = pos.map((p) => p.y);
    const pad = size + 2;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    svg.setAttribute(
      'viewBox',
      `${String(minX)} ${String(minY)} ${String(Math.max(...xs) + pad - minX)} ${String(Math.max(...ys) + pad - minY)}`,
    );
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', HOME_TEXT.reachLabel);
    svg.classList.add('home-reach-map');
    for (const { t, x, y } of pos) {
      const corners = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 180) * (60 * i - 30);
        return `${(x + (size - 1.5) * Math.cos(a)).toFixed(1)},${(y + (size - 1.5) * Math.sin(a)).toFixed(1)}`;
      }).join(' ');
      const hex = document.createElementNS(NS, 'polygon');
      hex.setAttribute('points', corners);
      hex.setAttribute('class', `home-reach-${t.state}`);
      svg.append(hex);
    }
    const key = (state: ReachTile['state'], label: string) =>
      el('li', {}, el('span', { class: `home-reach-key home-reach-key-${state}` }), label);
    return el(
      'div',
      { class: 'home-reach' },
      svg,
      el(
        'ul',
        { class: 'home-reach-legend' },
        key('now', HOME_TEXT.reachNow),
        key('new', HOME_TEXT.reachNew),
        key('outside', HOME_TEXT.reachOut),
      ),
    );
  }

  // ── Scene, taps and wandering ─────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    if (!home) throw new Error('no home to build');
    lastTier = options.tier();
    const built = new HomeScene(scene, atHome(home), {
      registry,
      lod: lodFor('closeUp', lastTier),
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
    });
    scene3d = built;
    if (moods && moods.mapId === mapId) built.setMoods(moods.moods);
    marks.attach(scene, built);
    syncScene();
    const canvas = scene.getEngine().getRenderingCanvas();
    if (canvas) {
      const stop = new AbortController();
      scene.onDisposeObservable.addOnce(() => {
        stop.abort();
        if (scene3d === built) scene3d = null;
      });
      listenForTaps(
        canvas,
        (x, y) => {
          const hit = built.pick(x, y);
          if (hit?.kind === 'spot') chooseSpot(hit.spot);
          else if (hit?.kind === 'squishy' && mapId && !working) options.onCloseUp?.(mapId, hit.id);
          else if (hit?.kind === 'house' && mode.kind === 'idle') goInside();
          else if (hit?.kind === 'building' && mode.kind !== 'build' && mode.kind !== 'moving') {
            setMode({ kind: 'selected', id: hit.id });
          }
        },
        stop.signal,
      );
    }
    return built.content;
  };

  /**
   * Hops one housed squishy every few seconds while the home is open. With
   * `prefers-reduced-motion` they stay put (and the home draws nothing).
   */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', () => {
    syncWander();
  });

  /** No happy bounces (#393) with Reduce Motion or on the low quality tier; the bubbles stay. */
  const staticCues = () => reducedMotion.matches || options.tier() === 'low';
  const marks = createMoodMarks(options.root);

  /** My squishies' work moods for a map arrived (#393): show them if it's this home. */
  function applyMoods(id: string, next: ReadonlyMap<string, WorkMood>): void {
    moods = { mapId: id, moods: next };
    if (id !== mapId || !scene3d) return;
    scene3d.setMoods(next);
    marks.refresh();
    options.invalidate();
    syncWander();
  }

  function syncWander(): void {
    const s = scene3d;
    const cheering = !staticCues() && (s?.happy.length ?? 0) > 0;
    const wanted = isOpen && !reducedMotion.matches && ((s?.wanderers.length ?? 0) > 0 || cheering);
    if (wanted && wanderTimer === undefined) scheduleHop();
    if (!wanted && wanderTimer !== undefined) {
      window.clearTimeout(wanderTimer);
      wanderTimer = undefined;
    }
  }

  function scheduleHop(): void {
    const delay = WANDER.everyMs + (Math.random() * 2 - 1) * WANDER.jitterMs;
    wanderTimer = window.setTimeout(() => {
      wanderTimer = undefined;
      const s = scene3d;
      const ids = s?.wanderers ?? [];
      const id = ids[wanderTurn % Math.max(1, ids.length)];
      wanderTurn += 1;
      const now = performance.now();
      if (s && id) s.hop(id, now);
      // A happy squishy's bounce rides the same beat (#393), so its frames
      // land with a hop's rather than adding their own.
      beats += 1;
      const happy = s && !staticCues() ? s.happy : [];
      const cheer =
        beats % MOOD_CUES.cheerEvery === 0 ? happy[cheerTurn % Math.max(1, happy.length)] : null;
      if (s && cheer) {
        cheerTurn += 1;
        s.cheer(cheer, now);
      }
      if (s && (id || cheer) && frame === 0) frame = requestAnimationFrame(tick);
      syncWander();
    }, delay);
  }

  /** Draws every frame while a hop plays, then stops (render on demand). */
  function tick(): void {
    frame = 0;
    const s = scene3d;
    if (!s || !isOpen) return;
    const tier = options.tier();
    if (tier !== lastTier) {
      lastTier = tier;
      s.setLod(lodFor('closeUp', tier));
    }
    const moving = s.step(performance.now());
    options.invalidate();
    if (moving) frame = requestAnimationFrame(tick);
  }

  async function open(): Promise<void> {
    const id = mapId;
    if (!id || isOpen) return;
    // The map's view goes once home's scene takes over, so read my ring's land now (#306).
    ringLand = ringTerrains(options.mapView?.() ?? null, user?.id ?? null);
    const at = generation;
    try {
      const fresh = await api.get(id);
      if (at !== generation) return;
      home = fresh;
    } catch (err) {
      // The home isn't on screen yet, so its own note can't show this.
      if (at === generation) options.onProblem(messageOf(err));
      return;
    }
    isOpen = true;
    mode = { kind: 'idle' };
    sheetOpen = false;
    say('');
    options.onOpen(id);
    options.showScene(build);
    render();
    syncWander();
    // How they feel about their jobs (#393): arrives through `setWorkMoods`; the home shows without it.
    options.loadWorkMoods?.(id);
  }

  function hide(): void {
    isOpen = false;
    mode = { kind: 'idle' };
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    syncWander();
    scene3d = null;
    render();
  }

  function close(): void {
    const id = mapId;
    hide();
    options.showScene(null);
    if (id) options.onClosed(id);
  }

  // ── Tile panel (home tiles and my fires on the map) ───────────────────
  /** What the panel shows for a fire on my land (#202): its card, or a step of a command. */
  type TileMode = 'card' | 'upgrade' | 'confirm';
  let tileMode: TileMode = 'card';
  /** Whose card a step is for: the tile's fire, its Training Grounds (#277) or Crafting Factory (#295). */
  type TileTarget = 'fire' | 'grounds' | 'factory' | 'resource';
  let tileTarget: TileTarget = 'fire';
  let tileNote = '';
  let tileWorking = false;
  /** The generation a Heart Seed panel already asked for my home in, so a failed read isn't retried in a loop. */
  let seedLoadedAt = -1;

  /** Reads my home (buildings, bag) for the panel when it isn't loaded yet. */
  async function loadForPanel(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id || home) return;
    try {
      const fresh = await api.get(id);
      if (at !== generation) return;
      home = fresh;
    } catch (err) {
      if (at === generation) tileNote = messageOf(err);
    }
    renderTile();
    for (const listener of buildListeners) listener();
  }
  const buildListeners: (() => void)[] = [];

  /** One command from the tile panel, one at a time; the panel says how it went. */
  async function tileAct(
    run: (
      mapId: string,
      send: <T>(command: (key: string) => Promise<T>) => Promise<T | null>,
    ) => Promise<HomeResponse | null>,
    done: string | ((next: HomeResponse) => string),
  ): Promise<void> {
    const id = mapId;
    if (!id || tileWorking) return;
    const at = generation;
    tileWorking = true;
    renderTile();
    try {
      const next = await run(id, (command) =>
        sendCommand(sendDeps, command, () => at === generation),
      );
      if (!next || at !== generation) return;
      home = next;
      tileMode = 'card';
      tileNote = typeof done === 'string' ? done : done(next);
    } catch (err) {
      if (at === generation) {
        tileNote = messageOf(err);
        if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
          home = null;
          await loadForPanel();
        }
      }
    } finally {
      tileWorking = false;
      if (at === generation) renderTile();
    }
  }

  /** A tile-panel button: a big one, a soft small one, or (`small`) a small one for a card row. */
  const tileButton = (
    label: string,
    onTap: () => void,
    testId: string,
    soft: boolean | 'small' = false,
  ) => {
    const look =
      soft === 'small'
        ? 'auth-button auth-button-small'
        : `auth-button bag-action${soft ? ' auth-button-soft auth-button-small' : ''}`;
    const b = el(
      'button',
      {
        type: 'button',
        class: look,
        'data-testid': testId,
      },
      label,
    );
    b.disabled = tileWorking;
    b.addEventListener('click', onTap);
    return b;
  };
  const tileRow = (...children: Node[]) =>
    el('div', { class: 'home-row home-row-wrap home-row-tight' }, ...children);
  const cardHead = (b: { buildingId: string }, level: number) =>
    el(
      'div',
      { class: 'home-card-head' },
      el(
        'h3',
        { class: 'home-section-title' },
        `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}`,
      ),
      el('span', { class: 'home-level' }, HOME_TEXT.level(level)),
    );

  /**
   * My tile out on the land: its fire (or the offer to build one), and on a
   * homestead its Training Grounds (#277). A step of either card has the
   * panel to itself.
   */
  function landTileNodes(tile: PublicTile): Node[] {
    if (!home) return [];
    // My Crafting Factory on this homestead (#295): one building a tile, so
    // it's the tile's only card.
    const factory = factoryTileOffer(tile, home);
    if (factory?.kind === 'factory') return factoryNodes(factory.factory);
    // A resource building (#601) fills its homestead the same way.
    const producing = resourceHere(home, tile);
    if (producing) return resourceNodes(tile, producing);
    const grounds = groundsTileOffer(tile, home);
    if (tileMode !== 'card' && tileTarget === 'grounds' && grounds) {
      return groundsNodes(tile, grounds);
    }
    const fire = fireTileNodes(tile);
    if (tileMode !== 'card' || !grounds) return fire;
    return [...fire, ...groundsNodes(tile, grounds)];
  }

  /** Training Grounds on a homestead, or the offer to build them (#277, mockup screen 6). */
  function groundsNodes(tile: PublicTile, offer: GroundsTileOffer): Node[] {
    const current = home;
    if (!current) return [];
    const note =
      tileMode !== 'card' && tileNote
        ? [el('p', { class: 'tile-action-note', role: 'status' }, tileNote)]
        : [];
    if (offer.kind === 'napping') {
      return [el('p', { class: 'tile-action-note' }, HOME_TEXT.groundsNapping)];
    }
    const lit = panel ? mapSafeTiles(panel.view).has(hexKey(tile)) : false;
    const light = el(
      'span',
      {
        class: `home-effect ${lit ? 'home-grounds-lit' : 'home-grounds-dark'}`,
        'data-testid': 'tile-grounds-light',
      },
      lit ? HOME_TEXT.groundsLit : HOME_TEXT.groundsDark,
    );
    if (offer.kind === 'build' || offer.kind === 'clear-first') {
      // Building them is the shared Build sheet's job (#371); this says how
      // the tile stands for the night.
      return [
        el(
          'div',
          { class: 'home-card', 'data-testid': 'tile-grounds-build' },
          el('span', { class: 'home-effects' }, light),
          el('p', { class: 'home-card-note' }, HOME_TEXT.groundsNight),
        ),
        ...note,
      ];
    }
    const { grounds, napping } = offer;
    const train = tileButton(
      HOME_TEXT.trainHere,
      () => {
        if (mapId) options.onJobs?.(mapId, { q: tile.q, r: tile.r });
      },
      'tile-grounds-train',
      'small',
    );
    if (napping || !options.onJobs) train.disabled = true;
    return standingNodes(
      grounds,
      'grounds',
      'grounds',
      [
        el('span', { class: 'home-effects' }, light),
        el(
          'p',
          { class: 'home-card-note', 'data-testid': 'tile-grounds-note' },
          buildingNote(grounds),
        ),
        el(
          'p',
          { class: 'home-card-note' },
          napping ? HOME_TEXT.groundsNapping : HOME_TEXT.groundsNight,
        ),
        el('p', { class: 'home-card-note' }, HOME_TEXT.groundsLose),
      ],
      [train],
    );
  }

  /** My Crafting Factory on a homestead (#295): Open, Upgrade, Take down. */
  function factoryNodes(factory: MyBuilding): Node[] {
    const open = tileButton(
      HOME_TEXT.openFactory,
      () => {
        options.onOpenFactory?.();
      },
      'tile-factory-open',
      'small',
    );
    if (!options.onOpenFactory) open.disabled = true;
    return standingNodes(
      factory,
      'factory',
      'factory',
      [
        // Sprout's tip the first time a kid sees their Factory (#294), on its homestead now.
        ...factoryTip(factory.id),
        el(
          'p',
          { class: 'home-card-note', 'data-testid': 'tile-factory-note' },
          buildingNote(factory),
        ),
        el('p', { class: 'home-card-note' }, HOME_TEXT.factoryLose),
      ],
      [open],
    );
  }

  /**
   * My resource building on its homestead (#601 PR 7): running with its
   * storage meter, full, paused for upkeep, napping, or a sleeping Pumpkin
   * Barn out of season. Collect runs a settle (owner decision Q3); Upkeep
   * opens the Heart Coins sheet's order (Q5).
   */
  function resourceNodes(tile: PublicTile, b: MyBuilding): Node[] {
    const current = home;
    if (!current) return [];
    const now = options.now?.() ?? Date.parse(current.now);
    const card = resourceCard(b, tile, current.seasons, now);
    const actions: Node[] = [];
    if (card?.collect && options.onCollect) {
      const collect = options.onCollect;
      actions.push(
        tileButton(
          RESOURCE_TEXT.collect,
          () => {
            void collect().then(() => {
              home = null;
              void loadForPanel();
            });
          },
          'tile-resource-collect',
          'small',
        ),
      );
    }
    if (options.onUpkeep) {
      actions.push(
        tileButton(RESOURCE_TEXT.coins, options.onUpkeep, 'tile-resource-upkeep-order', 'small'),
      );
    }
    return standingNodes(b, 'resource', 'resource', card ? resourceCardLines(card) : [], actions);
  }

  /**
   * A building of mine standing on a tile out on the land (#277, #295): its
   * card with `lines` and `actions`, plus Upgrade and Take down, or a step
   * of either. `prefix` names its test ids (`tile-<prefix>-…`).
   */
  function standingNodes(
    b: MyBuilding,
    target: TileTarget,
    prefix: string,
    lines: readonly Node[],
    actions: readonly Node[],
  ): Node[] {
    const current = home;
    if (!current) return [];
    const note =
      tileMode !== 'card' && tileNote
        ? [el('p', { class: 'tile-action-note', role: 'status' }, tileNote)]
        : [];
    const card: Node[] = [cardHead(b, b.level)];
    const upgradeAt = upgradeOffer(current, b);
    if (tileMode === 'upgrade' && upgradeAt) {
      const go = tileButton(
        HOME_TEXT.upgradeNow,
        () =>
          void tileAct(
            (id, send) => send((key) => api.upgrade(id, b.id, key)),
            HOME_TEXT.upgraded(buildingName(b.buildingId), upgradeAt.to),
          ),
        `tile-${prefix}-upgrade-confirm`,
      );
      if (!upgradeAt.affordable) go.disabled = true;
      card.push(
        el('p', { class: 'home-card-note' }, upgradeAt.line),
        needRow(upgradeAt.needs),
        tileRow(
          go,
          tileButton(
            HOME_TEXT.notNow,
            () => {
              tileMode = 'card';
              renderTile();
            },
            `tile-${prefix}-upgrade-cancel`,
            true,
          ),
        ),
      );
    } else if (tileMode === 'confirm') {
      const back = costText(refundPreview(b));
      card.push(
        el('p', { class: 'home-card-note' }, HOME_TEXT.confirm(buildingName(b.buildingId), back)),
        tileRow(
          tileButton(
            HOME_TEXT.yes,
            () => {
              let refund = '';
              void tileAct(
                async (id, send) => {
                  const res = await send((key) => api.remove(id, b.id, key));
                  if (!res) return null;
                  refund = describeItems(res.refund);
                  return res.home;
                },
                () => HOME_TEXT.removed(refund),
              );
            },
            `tile-${prefix}-remove-confirm`,
          ),
          tileButton(
            HOME_TEXT.keep,
            () => {
              tileMode = 'card';
              renderTile();
            },
            `tile-${prefix}-keep`,
            true,
          ),
        ),
      );
    } else {
      card.push(
        ...lines,
        tileRow(
          ...actions,
          ...(upgradeAt
            ? [
                tileButton(
                  HOME_TEXT.upgrade,
                  () => {
                    tileMode = 'upgrade';
                    tileTarget = target;
                    tileNote = '';
                    renderTile();
                  },
                  `tile-${prefix}-upgrade`,
                  'small',
                ),
              ]
            : []),
          tileButton(
            HOME_TEXT.takeDown,
            () => {
              tileMode = 'confirm';
              tileTarget = target;
              tileNote = '';
              renderTile();
            },
            `tile-${prefix}-remove`,
            true,
          ),
        ),
      );
    }
    return [el('div', { class: 'home-card', 'data-testid': `tile-${prefix}` }, ...card), ...note];
  }

  /** A fire out on my land, or the offer to build one (#202). */
  function fireTileNodes(tile: PublicTile): Node[] {
    if (!home) return [];
    const offer = landTileOffer(tile, home);
    const note = tileNote ? [el('p', { class: 'tile-action-note', role: 'status' }, tileNote)] : [];
    if (offer.kind === 'node') return [el('p', { class: 'tile-action-note' }, offer.line), ...note];
    if (offer.kind === 'none') return note;
    // Building one is the shared Build sheet's job (#371).
    if (offer.kind === 'build') return note;
    const { fire } = offer;
    const current = home;
    const card: Node[] = [cardHead(fire, fire.level)];
    const upgradeAt = upgradeOffer(current, fire);
    if (tileMode === 'upgrade' && upgradeAt) {
      const go = tileButton(
        HOME_TEXT.upgradeNow,
        () =>
          void tileAct(
            (id, send) => send((key) => api.upgrade(id, fire.id, key)),
            HOME_TEXT.upgraded(buildingName(fire.buildingId), upgradeAt.to),
          ),
        'tile-fire-upgrade-confirm',
      );
      if (!upgradeAt.affordable) go.disabled = true;
      card.push(
        el('p', { class: 'home-card-note' }, upgradeAt.line),
        needRow(upgradeAt.needs),
        tileRow(
          go,
          tileButton(
            HOME_TEXT.notNow,
            () => {
              tileMode = 'card';
              renderTile();
            },
            'tile-fire-upgrade-cancel',
            true,
          ),
        ),
      );
    } else if (tileMode === 'confirm') {
      const back = costText(refundPreview(fire));
      card.push(
        el(
          'p',
          { class: 'home-card-note' },
          HOME_TEXT.confirm(buildingName(fire.buildingId), back),
        ),
        tileRow(
          tileButton(
            HOME_TEXT.yes,
            () => {
              let refund = '';
              void tileAct(
                async (id, send) => {
                  const res = await send((key) => api.remove(id, fire.id, key));
                  if (!res) return null;
                  refund = describeItems(res.refund);
                  return res.home;
                },
                () => HOME_TEXT.removed(refund),
              );
            },
            'tile-fire-remove-confirm',
          ),
          tileButton(
            HOME_TEXT.keep,
            () => {
              tileMode = 'card';
              renderTile();
            },
            'tile-fire-keep',
            true,
          ),
        ),
      );
    } else {
      const data = BUILDING_DATA.get(fire.buildingId);
      const cost =
        data?.kind === 'hearthfire'
          ? costText({ [data.fuelResource]: data.fuelPerNight * FUEL_NIGHTS })
          : '';
      // Short labels in one row of small buttons, so the panel stays clear of the trays.
      const fuelButton = tileButton(
        HOME_TEXT.landFuel,
        () =>
          void tileAct(
            (id, send) => send((key) => api.fuel(id, fire.id, FUEL_NIGHTS, key)),
            HOME_TEXT.fuelled,
          ),
        'tile-fire-fuel',
        'small',
      );
      fuelButton.setAttribute('aria-label', `${HOME_TEXT.addFuel} (${cost})`);
      if ((fire.fuelSpace ?? 0) === 0) fuelButton.disabled = true;
      card.push(
        el('p', { class: 'home-card-note', 'data-testid': 'tile-fire-note' }, buildingNote(fire)),
        tileRow(
          ...(upgradeAt
            ? [
                tileButton(
                  HOME_TEXT.upgrade,
                  () => {
                    tileMode = 'upgrade';
                    tileTarget = 'fire';
                    tileNote = '';
                    renderTile();
                  },
                  'tile-fire-upgrade',
                  'small',
                ),
              ]
            : []),
          fuelButton,
          tileButton(
            HOME_TEXT.takeDown,
            () => {
              tileMode = 'confirm';
              tileTarget = 'fire';
              tileNote = '';
              renderTile();
            },
            'tile-fire-remove',
            true,
          ),
        ),
      );
    }
    return [el('div', { class: 'home-card', 'data-testid': 'tile-fire' }, ...card), ...note];
  }

  function renderTile(): void {
    if (!panel) return;
    const { container, tile } = panel;
    const me = user?.id ?? null;
    const mine = me !== null && tile.ownerUserId === me;
    // A step of a fire's card (build, upgrade, take down) has the panel to
    // itself, so it stays short and clear of the side trays.
    const focused = mine && tile.homeSlot === null && tileMode !== 'card';
    setPanelFocus(container, 'home-fire', focused);
    if (mine && tile.homeSlot === null) {
      if (!home) void loadForPanel();
      container.replaceChildren(...landTileNodes(tile));
      return;
    }
    const lines = homeTileLines(tile, me);
    const nodes: Node[] = lines.map((line) => el('p', { class: 'tile-action-note' }, line));
    // My Heart Seed, once I can name my home (#306): say where to do it. The
    // gate comes with my home, read once (the same GET the Home button makes).
    if (mine && isSeedTile(panel.view, tile)) {
      if (!home && seedLoadedAt !== generation) {
        seedLoadedAt = generation;
        void loadForPanel();
      }
      if (nameReady(home?.naming)) {
        nodes.push(
          el(
            'p',
            { class: 'tile-action-note tile-name-nudge', 'data-testid': 'tile-name-nudge' },
            HOME_NAME_TEXT.seedLine,
          ),
        );
      }
    }
    if (tile.homeSlot !== null && mine) {
      nodes.push(
        el(
          'button',
          {
            type: 'button',
            class: 'auth-button bag-action tile-action-pair',
            'data-testid': 'tile-home',
          },
          `🏡 ${HOME_TEXT.goHome}`,
        ),
      );
      nodes.at(-1)?.addEventListener('click', () => void open());
    }
    container.replaceChildren(...nodes);
  }

  /**
   * What the shared Build sheet can put up on one of my tiles out on the land
   * (#371): the Hearthfire, the Jack-o'-Lantern in season, and on a
   * homestead the Training Grounds and my one Crafting Factory (#295). Each
   * takes the whole tile.
   */
  const buildSource: BuildSource = {
    cards: (tile) => {
      if (!home || !user || tile.ownerUserId !== user.id || tile.homeSlot !== null) return [];
      const card = (b: Building, effect: string): BuildCard => ({
        id: b.id,
        icon: buildingIcon(b.id),
        name: buildingName(b.id),
        effect,
        cost: buildCost(b),
        area: 'spot',
        blocked: null,
        craft: null,
      });
      const fire = landTileOffer(tile, home);
      const grounds = groundsTileOffer(tile, home);
      const factory = factoryTileOffer(tile, home);
      // The one resource building this homestead's land takes (#601 PR 7).
      const producing = resourceBuildCards(tile, home, user.id);
      // A homestead spot's buildings wait beside Clear land (`clearCards`, #242).
      return [
        ...(fire.kind === 'build'
          ? [
              card(fire.building, effectChips(fire.building)[0] ?? fire.building.description),
              ...(fire.lantern
                ? [
                    card(
                      fire.lantern.building,
                      effectChips(fire.lantern.building)[0] ?? fire.lantern.building.description,
                    ),
                  ]
                : []),
            ]
          : []),
        ...(grounds?.kind === 'build'
          ? [
              card(
                grounds.building,
                effectChips(grounds.building)[0] ?? grounds.building.description,
              ),
            ]
          : []),
        ...(factory?.kind === 'build'
          ? [
              card(
                factory.building,
                effectChips(factory.building)[0] ?? factory.building.description,
              ),
            ]
          : []),
        ...producing,
      ];
    },
    build: async (card, tile) => {
      const id = mapId;
      const current = home;
      if (!id || !current) return null;
      const at = generation;
      const grounds = groundsTileOffer(tile, current);
      const factory = factoryTileOffer(tile, current);
      const isGrounds = grounds?.kind === 'build' && grounds.building.id === card.id;
      const isFactory = factory?.kind === 'build' && factory.building.id === card.id;
      const producing =
        user && resourceBuildCards(tile, current, user.id).find((c) => c.id === card.id);
      const spot = isGrounds
        ? grounds.spot
        : isFactory
          ? factory.spot
          : producing
            ? producing.spot
            : 0;
      try {
        const next = await sendCommand(
          sendDeps,
          (key) => api.place(id, { buildingId: card.id, q: tile.q, r: tile.r, spot }, key),
          () => at === generation,
        );
        if (!next || at !== generation) return null;
        home = next;
        tileNote = '';
        renderTile();
        return isGrounds
          ? HOME_TEXT.groundsBuilt
          : isFactory
            ? HOME_TEXT.factoryBuilt
            : producing
              ? RESOURCE_TEXT.built(producing.name)
              : HOME_TEXT.fireBuilt;
      } catch (err) {
        if (at === generation && err instanceof ApiRequestError && err.code === 'CONFLICT') {
          home = null;
          void loadForPanel();
        }
        throw err;
      }
    },
    onChange: (listener) => {
      buildListeners.push(listener);
    },
    // Another feature built something that took from the bag: read it again.
    invalidate: () => {
      if (!home) return;
      home = null;
      renderTile();
    },
  };

  return {
    buildSource,
    setWorkMoods: (id, next) => {
      applyMoods(id, next);
    },
    setMap: (next) => {
      if (next === mapId) return;
      generation += 1;
      mapId = next;
      home = null;
      if (isOpen) hide();
      render();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      moods = null;
      mapId = null;
      home = null;
      if (isOpen) hide();
      render();
    },
    open,
    tileActions: {
      show: (container, tile, view) => {
        // Another tile: back to its card, with nothing said yet.
        if (panel?.tile.q !== tile.q || panel.tile.r !== tile.r) {
          tileMode = 'card';
          tileTarget = 'fire';
          tileNote = '';
          // Sprout's Factory tip shows once: not again on the next card.
          tipFor = null;
          // Read my fires and bag afresh for a tile of mine out on my land.
          if (!isOpen && tile.homeSlot === null && tile.ownerUserId === user?.id) home = null;
        }
        panel = { container, tile, view };
        renderTile();
        render();
      },
      hide: () => {
        tipFor = null;
        panel?.container.replaceChildren();
        if (panel) setPanelFocus(panel.container, 'home-fire', false);
        panel = null;
        render();
      },
    },
    get debug() {
      if (!mapId) return null;
      return {
        mapId,
        open: isOpen,
        mode: mode.kind,
        items: { ...(home?.items ?? {}) },
        buildings: (home?.buildings ?? []).map((b) => ({
          id: b.id,
          buildingId: b.buildingId,
          q: b.q,
          r: b.r,
          spot: b.spot,
          lit: b.lit,
          nightsLeft: b.nightsLeft,
          residents: b.residents,
        })),
        squishies: home?.squishies.length ?? 0,
        scene: scene3d?.stats ?? null,
        hops: scene3d?.hops ?? 0,
        moodCues: staticCues() ? ('static' as const) : ('bounce' as const),
        moodMarks: marks.shown,
        moodLayout: marks.layout,
        sheet: sheetOpen ? ('open' as const) : ('peek' as const),
      };
    },
  };
}

/** A list row's name with its rarity dot before it, where the row is tight (#240). */
function squishyTitle(
  squishy: HomeSquishy,
  name: string,
  species: ReadonlyMap<string, Species>,
): HTMLElement {
  const rarity = squishyRarity(squishy, species);
  return el('span', { class: 'home-list-title' }, ...(rarity ? [rarityDot(rarity)] : []), name);
}

/** `localStorage`, or null where it throws (private mode, blocked site data). */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
