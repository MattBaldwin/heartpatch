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
import type { InventoryResponse } from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import { BUILD_TEXT, pickCard, type BuildCard } from '../building/build-model.js';
import { createBuildSheet } from '../building/build-sheet.js';
import { setPanelFocus } from '../building/panel-focus.js';
import type { BuildSource } from '../building/tile-build.js';
import { factoryApi, type FactoryApi } from '../factory/factory-api.js';
import { createFactoryPanel } from '../factory/factory-panel.js';
import { FACTORY_TEXT, goingCount } from '../factory/factory-view.js';
import { GameClock } from '../inventory/game-clock.js';
import { inventoryApi } from '../inventory/inventory-api.js';
import { recipeBookApi } from '../recipes/recipe-book-api.js';
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
import { HOME_SHEET, WANDER } from './home-config.js';
import { mapSafeTiles } from './home-layout.js';
import { homeApi, type HomeApi } from './home-api.js';
import { afterHandle } from './home-peek.js';
import { HomeScene, type HomeSceneStats } from './home-scene.js';
import {
  atHome,
  buildingIcon,
  buildingName,
  buildingNote,
  buildRows,
  effectChips,
  costText,
  upgradeOffer,
  upgradeReach,
  HOME_SAFE_LINE,
  FIRES_ON_LAND,
  freeHomeSpots,
  fuelAllOffer,
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
import { HOUSE_TEXT, houseCard } from '../house/house-view.js';
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
  /** A squishy chip was tapped: open its care sheet (#19). */
  onCare?: (mapId: string, squishyId: string) => void;
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
  /** Whether "Jobs & team" shows on this map (not on the Tutorial Glade). */
  showJobs?: (mapId: string) => boolean;
  /**
   * The peek bar's "🐾 Squishies" (#412). Without it, the button opens the
   * sheet to the squishy list; the Squishies roster (#375) can take it over.
   */
  onSquishies?: (mapId: string) => void;
  /**
   * "📖 Recipe book" on a build row short of something you make (the
   * Jack-o'-Lantern): leaves the home and opens the recipe book.
   */
  onRecipeBook?: () => void;
  api?: HomeApi;
  /** The Crafting Factory card's calls (#294): its batches come with every settle. */
  factory?: {
    api?: FactoryApi;
    /**
     * Reads the bag, batches included, with no side effects. Home never
     * settles: the Bag screen does (one settle loop, and the welcome-back
     * card sees what landed), when the kid is back on the map.
     */
    read?: (mapId: string) => Promise<InventoryResponse>;
    openPages?: () => Promise<readonly string[]>;
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
  | { readonly kind: 'confirm-remove'; readonly id: string };

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
  /** The main view's sheet (#412): the short peek bar, or opened into the full lists. */
  readonly sheet: 'peek' | 'open';
  /** The Factory card's batches going (#294), null while it's not loaded. */
  readonly factoryBatches: number | null;
  /** What the Factory card's panel shows, null when it isn't on screen. */
  readonly factoryPanel: 'list' | 'pick' | 'stop' | null;
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
  readonly debug: HomeDebug | null;
}

// Player-facing text (style guide §6, §9).
export const HOME_TEXT = {
  home: 'Home',
  title: 'Your home base',
  build: 'Build',
  back: 'Back to map',
  pick: 'Tap a glowing spot!',
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
  friends: 'Your squishies',
  jobs: '🧺 Jobs & team',
  /** The peek bar's button to the squishies (#412; 🐾 as the Squishies roster, #375). */
  squishies: '🐾 Squishies',
  /** The sheet handle, for VoiceOver (#412). */
  showMore: 'Show more',
  showLess: 'Show less',
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
  let lastTier: QualityTier | null = null;
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;

  // ── The Crafting Factory card (#294) ─────────────────────────────────
  const fapi = options.factory?.api ?? factoryApi;
  const readFactory = options.factory?.read ?? ((id: string) => inventoryApi.get(id));
  const readPages =
    options.factory?.openPages ?? (() => recipeBookApi.get().then((res) => res.unlocked));
  const tipStorage =
    options.factory?.storage === undefined ? safeStorage() : options.factory.storage;
  const factoryClock = new GameClock();
  /** The bag as the Factory card last read it (its batches, items and seasons). */
  let factoryBag: InventoryResponse | null = null;
  let factoryPages = new Set<string>();
  /** Read once per map without being asked (a failed read waits for the next tap). */
  let factoryTried = false;
  /** The Factory card showing Sprout's one-time tip (#294), or null. */
  let tipFor: string | null = null;
  const factoryPanel = createFactoryPanel({
    now: () => factoryClock.now(),
    start: (recipeId, count) => factoryCommand((id, key) => fapi.start(id, recipeId, count, key)),
    stop: (batchId) =>
      factoryCommand(async (id, key) => {
        const res = await fapi.stop(id, batchId, key);
        say(FACTORY_TEXT.stopped(describeItems(res.refunded)));
        return res;
      }),
    isOpen: (key) => factoryPages.has(key),
  });

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
  const body = el('div', { class: 'home-body' });
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
  });
  let pressY: number | null = null;
  let releasedAt = -Infinity;
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
    handle,
    note,
    body,
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
   * Reads the Factory's batches and redraws its card. A read, not a settle:
   * counts and countdowns run on the game clock, and what's made lands in
   * the bag through the Bag screen's settle (or as the next batch starts).
   */
  async function loadFactory(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    factoryTried = true;
    try {
      const [res] = await Promise.all([
        readFactory(id),
        readPages()
          .then((keys) => {
            factoryPages = new Set(keys);
          })
          .catch(() => undefined),
      ]);
      if (at !== generation) return;
      factoryClock.sync(res.now);
      factoryBag = res;
      render();
    } catch (err) {
      if (at === generation) say(messageOf(err));
    }
  }

  const factoryCardUp = () =>
    isOpen &&
    mode.kind === 'selected' &&
    home?.buildings.find((b) => 'id' in mode && b.id === mode.id)?.kind === 'factory';

  /** A Factory command; its reply is the whole bag. Null once it ran, else why not. */
  async function factoryCommand(
    run: (mapId: string, key: string) => Promise<InventoryResponse>,
  ): Promise<string | null> {
    const id = mapId;
    if (!id) return null;
    const at = generation;
    try {
      const res = await sendCommand(
        sendDeps,
        (key) => run(id, key),
        () => at === generation,
      );
      if (!res || at !== generation) return null;
      factoryClock.sync(res.now);
      factoryBag = res;
      // The bag changed: the home's costs and chips read it again.
      void refresh();
      return null;
    } catch (err) {
      if (at === generation && err instanceof ApiRequestError && err.code === 'CONFLICT') {
        void loadFactory();
      }
      return messageOf(err);
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
        say(messageOf(err));
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
    const rows = buildRows(current).filter(
      (r) => r.option.kind !== 'built' && r.option.kind !== 'land' && r.option.kind !== 'homestead',
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
    const spots = row ? freeHomeSpots(atHome(current), null, row.building.slot) : [];
    const wanted = mode.kind === 'build' ? mode.spot : null;
    const spot =
      spots.find((s) => s.q === wanted?.q && s.r === wanted.r && s.spot === wanted.spot) ??
      spots[0] ??
      null;
    return { cards, card, spots, spot };
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
      return freeHomeSpots(home, m.id, slot).filter(
        (s) => !(moving && s.q === moving.q && s.r === moving.r && s.spot === moving.spot),
      );
    }
    return [];
  };

  function show(next: HomeResponse): void {
    home = next;
    // An upgrade (or a take-down) changes the Factory's spots: read its batches again.
    const factory = next.buildings.find((b) => b.kind === 'factory');
    const known = factoryBag?.factory ?? null;
    if (known && (factory?.id !== known.buildingId || factory.level !== known.level)) {
      void loadFactory();
    }
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
    if (factoryCardUp()) {
      factoryPanel.showList();
      void loadFactory();
    } else {
      tipFor = null;
      factoryPanel.pause();
    }
  };

  function render(): void {
    // The Factory card opened (a tap on it, or just built): read its batches once.
    if (factoryBag === null && !factoryTried && factoryCardUp()) void loadFactory();
    entry.hidden = mapId === null || isOpen;
    overlay.hidden = !isOpen;
    if (!isOpen || !home) {
      body.replaceChildren();
      return;
    }
    const current = home;
    const peek = mode.kind === 'idle' && !sheetOpen;
    handle.hidden = mode.kind !== 'idle';
    status.textContent = HOME_SAFE_LINE;
    renderFuelAll(current);
    const row = (...children: Node[]) => el('div', { class: 'home-row' }, ...children);

    switch (mode.kind) {
      case 'idle': {
        handle.setAttribute('aria-expanded', String(sheetOpen));
        handle.setAttribute('aria-label', sheetOpen ? HOME_TEXT.showLess : HOME_TEXT.showMore);
        const chips = atHome(current).buildings.map((b) =>
          button(
            `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}${factoryChip(b)}`,
            () => {
              setMode({ kind: 'selected', id: b.id });
            },
            { 'data-building': b.id, class: 'home-chip' },
            true,
          ),
        );
        const species = speciesMap(current);
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
            current.squishies.length > 0 && (options.onSquishies || options.onCare)
              ? button(
                  HOME_TEXT.squishies,
                  () => {
                    if (options.onSquishies && mapId) options.onSquishies(mapId);
                    else setSheet(true);
                  },
                  { 'data-testid': 'home-squishies' },
                  true,
                )
              : null;
          const shortcuts = [squishies, jobs, houseShortcut(current)].filter((b) => b !== null);
          body.replaceChildren(
            ...(shortcuts.length > 0
              ? [el('div', { class: 'home-row home-row-wrap home-peek-row' }, ...shortcuts)]
              : []),
            actions,
          );
          break;
        }
        const friends = current.squishies.map((s) =>
          button(
            `💗 ${squishyName(s, species)}`,
            () => {
              if (mapId) options.onCare?.(mapId, s.id);
            },
            { 'data-care-squishy': s.id, class: 'home-chip' },
            true,
          ),
        );
        body.replaceChildren(
          el('h3', { class: 'home-section-title' }, HOME_TEXT.yours),
          chips.length > 0
            ? el('div', { class: 'home-chips' }, ...chips)
            : el('p', { class: 'home-empty' }, HOME_TEXT.none),
          ...houseCardNodes(current),
          ...(friends.length > 0 && options.onCare
            ? [
                el('h3', { class: 'home-section-title' }, HOME_TEXT.friends),
                el('div', { class: 'home-chips', 'data-testid': 'home-friends' }, ...friends),
              ]
            : []),
          ...(jobs ? [row(jobs)] : []),
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
            view.spots.length === 0 ? '' : mode.spot ? BUILD_TEXT.spotChosen : BUILD_TEXT.tapSpot,
          allEdges: null,
          working,
          // The Hearthfire has no card here: it goes out on my land.
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
                close();
                options.onRecipeBook?.();
              }
            : undefined,
        });
        if (homeSheet.element.parentElement !== body) body.replaceChildren(homeSheet.element);
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

  /** The peek bar's way into the house (#381), beside Squishies and Jobs: only while the house is on. */
  function houseShortcut(current: HomeResponse): HTMLButtonElement | null {
    if (!houseCard(current) || !options.onHouse) return null;
    const b = button(HOUSE_TEXT.shortcut, goInside, { 'data-testid': 'home-house-shortcut' }, true);
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
    if (b.kind === 'factory') {
      // The queue panel (#294): batches going, Start a batch, Stop.
      if (factoryBag?.factory) {
        factoryPanel.update({
          view: factoryBag.factory,
          items: factoryBag.items,
          seasons: factoryBag.seasons,
        });
      }
      card.push(...factoryTip(b.id), factoryPanel.element);
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

  /** " · 2 going" on the Factory's chip while batches are going (#294). */
  function factoryChip(b: MyBuilding): string {
    const view = factoryBag?.factory;
    if (b.kind !== 'factory' || !view) return '';
    const going = goingCount(view, factoryClock.now());
    return going > 0 ? ` · ${String(going)} going` : '';
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

  function syncWander(): void {
    const wanted = isOpen && !reducedMotion.matches && (scene3d?.wanderers.length ?? 0) > 0;
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
      if (s && id) {
        s.hop(id, performance.now());
        if (frame === 0) frame = requestAnimationFrame(tick);
      }
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
  /** Whose card a step is for: the tile's fire, or its Training Grounds (#277). */
  let tileTarget: 'fire' | 'grounds' = 'fire';
  let tileNote = '';
  let tileWorking = false;

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
    if (offer.kind === 'build') {
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
    const card: Node[] = [cardHead(grounds, grounds.level)];
    const upgradeAt = upgradeOffer(current, grounds);
    if (tileMode === 'upgrade' && upgradeAt) {
      const go = tileButton(
        HOME_TEXT.upgradeNow,
        () =>
          void tileAct(
            (id, send) => send((key) => api.upgrade(id, grounds.id, key)),
            HOME_TEXT.upgraded(buildingName(grounds.buildingId), upgradeAt.to),
          ),
        'tile-grounds-upgrade-confirm',
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
            'tile-grounds-upgrade-cancel',
            true,
          ),
        ),
      );
    } else if (tileMode === 'confirm') {
      const back = costText(refundPreview(grounds));
      card.push(
        el(
          'p',
          { class: 'home-card-note' },
          HOME_TEXT.confirm(buildingName(grounds.buildingId), back),
        ),
        tileRow(
          tileButton(
            HOME_TEXT.yes,
            () => {
              let refund = '';
              void tileAct(
                async (id, send) => {
                  const res = await send((key) => api.remove(id, grounds.id, key));
                  if (!res) return null;
                  refund = describeItems(res.refund);
                  return res.home;
                },
                () => HOME_TEXT.removed(refund),
              );
            },
            'tile-grounds-remove-confirm',
          ),
          tileButton(
            HOME_TEXT.keep,
            () => {
              tileMode = 'card';
              renderTile();
            },
            'tile-grounds-keep',
            true,
          ),
        ),
      );
    } else {
      const train = tileButton(
        HOME_TEXT.trainHere,
        () => {
          if (mapId) options.onJobs?.(mapId, { q: tile.q, r: tile.r });
        },
        'tile-grounds-train',
        'small',
      );
      if (napping || !options.onJobs) train.disabled = true;
      card.push(
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
        tileRow(
          train,
          ...(upgradeAt
            ? [
                tileButton(
                  HOME_TEXT.upgrade,
                  () => {
                    tileMode = 'upgrade';
                    tileTarget = 'grounds';
                    tileNote = '';
                    renderTile();
                  },
                  'tile-grounds-upgrade',
                  'small',
                ),
              ]
            : []),
          tileButton(
            HOME_TEXT.takeDown,
            () => {
              tileMode = 'confirm';
              tileTarget = 'grounds';
              tileNote = '';
              renderTile();
            },
            'tile-grounds-remove',
            true,
          ),
        ),
      );
    }
    return [el('div', { class: 'home-card', 'data-testid': 'tile-grounds' }, ...card), ...note];
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
   * (#371): the Hearthfire, the Jack-o'-Lantern in season, and Training
   * Grounds on a homestead. All of them go on the tile's one spot.
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
      ];
    },
    build: async (card, tile) => {
      const id = mapId;
      const current = home;
      if (!id || !current) return null;
      const at = generation;
      const grounds = groundsTileOffer(tile, current);
      const isGrounds = grounds?.kind === 'build' && grounds.building.id === card.id;
      const spot = isGrounds ? grounds.spot : 0;
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
        return isGrounds ? HOME_TEXT.groundsBuilt : HOME_TEXT.fireBuilt;
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
    setMap: (next) => {
      if (next === mapId) return;
      generation += 1;
      factoryBag = null;
      factoryTried = false;
      mapId = next;
      home = null;
      if (isOpen) hide();
      render();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      factoryBag = null;
      factoryTried = false;
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
          // Read my fires and bag afresh for a tile of mine out on my land.
          if (!isOpen && tile.homeSlot === null && tile.ownerUserId === user?.id) home = null;
        }
        panel = { container, tile, view };
        renderTile();
        render();
      },
      hide: () => {
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
        sheet: sheetOpen ? ('open' as const) : ('peek' as const),
        factoryBatches: factoryBag?.factory ? factoryBag.factory.batches.length : null,
        factoryPanel: factoryPanel.element.isConnected ? factoryPanel.mode : null,
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
