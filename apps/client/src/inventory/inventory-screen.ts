import type {
  InventoryResponse,
  ItemCounts,
  Landed,
  PublicTile,
  PublicUser,
} from '@heartpatch/shared';
import { factoryApi, type FactoryApi } from '../factory/factory-api.js';
import { createFactoryPanel } from '../factory/factory-panel.js';
import { createFactoryStrip } from '../factory/factory-strip.js';
import {
  batchRows,
  FACTORY_TEXT,
  showsWelcomeBack,
  welcomeChips,
} from '../factory/factory-view.js';
import { recipeBookApi } from '../recipes/recipe-book-api.js';
import { ApiRequestError } from '../net/api.js';
import type { TileActions } from '../map/map-screen.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import {
  bagCrafts,
  bagItems,
  bagRecipes,
  describeItems,
  gatherChip,
  itemName,
  landedText,
  trainedText,
} from './bag-view.js';
import { formatTimeLeft, GameClock } from './game-clock.js';
import { inventoryApi, type InventoryApi } from './inventory-api.js';
import { itemDetail } from './item-detail.js';
import { itemIcon } from './item-icons.js';
import { COMMAND_RETRY_MS, sendCommand } from './send-command.js';
import { tileAction, type TileAction } from './tile-action.js';
import './inventory.css';

// The bag and gathering (#17, design doc §12): a Bag entry in the My Home tray that
// opens a sheet of items (big numbers, pictures) and recipes, and the
// Gather button inside the map's tile panel. Timers are the server's
// timestamps; the screen only counts down to them on the game clock and asks
// the server to do everything (CLAUDE.md rule 1). Finished crafts, gathers
// and gatherers' cycles go straight into the bag (owner decision 2026-10-06):
// the screen asks the server to settle when a map opens, when the app comes
// back, and when the server says the next thing is due, and pops up what landed.

export interface InventoryScreenOptions {
  root: HTMLElement;
  /** Where the entry button goes (a tray over the map, ui/trays); defaults to `root`. */
  entryRoot?: HTMLElement;
  api?: InventoryApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
  /** Dev builds show a "get stuff" button (server `HP_DEV_SQUISHY_GRANTS`). */
  devTools?: boolean;
  /** Something new landed in the bag (a gather or craft finished): the recipe book may open a page. */
  onCollected?: () => void;
  /** The Crafting Factory's calls (#294). */
  factoryApi?: FactoryApi;
  /** The recipe book pages this account has opened (only those can be queued). */
  openPages?: () => Promise<readonly string[]>;
  /** Where "when did I last see this patch" is kept, for the welcome-back card (null: nowhere). */
  storage?: Storage | null;
  /** "See Factory" on the welcome-back card: open home (the Factory's own card). */
  onSeeFactory?: () => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface InventoryDebug {
  readonly mapId: string;
  readonly items: ItemCounts;
  readonly gathers: number;
  readonly crafts: number;
  readonly seasons: readonly string[];
  readonly bagOpen: boolean;
  /** The tile panel's action right now, if it's showing one of your nodes. */
  readonly tileAction: TileAction['kind'] | null;
  /** The gathering chip over the map: null while hidden; `ready` for the moment before it lands. */
  readonly chip: 'waiting' | 'ready' | null;
  /** The "it landed!" pop-up's words while it shows, else null. */
  readonly toast: string | null;
  /** Settles so far that put something in the bag. */
  readonly landings: number;
  /** Crafting Factory batches going (#294), null with no Factory. */
  readonly batches: number | null;
  /** The Factory sheet is open, and what its panel shows. */
  readonly factorySheet: 'list' | 'pick' | 'stop' | null;
  /** The welcome-back card is showing. */
  readonly welcome: boolean;
}

export interface InventoryScreen {
  /** The map on screen (null: none): shows the Bag button and loads the bag. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  readonly tileActions: TileActions;
  /** The bag on screen now (items, crafts, seasons), or null. */
  readonly bag: InventoryResponse | null;
  /** Settles the map on screen (banks what finished, owner decision 2026-10-06) and reads the bag again. */
  refresh: () => Promise<void>;
  /**
   * Starts a craft for the map on screen (the recipe book's "Make it"): the
   * server checks and takes the items (CLAUDE.md rule 1). Resolves to null
   * once started, or to a kid-readable line saying why not.
   */
  craft: (recipeId: string) => Promise<string | null>;
  /**
   * Starts a Crafting Factory batch (#294) of up to `count` (the server caps
   * it at what the bag can pay for). Null once started, or a line saying why not.
   */
  queue: (recipeId: string, count: number) => Promise<string | null>;
  /** Stops a Factory batch: what's made is kept, the rest comes back. */
  stopBatch: (batchId: string) => Promise<string | null>;
  /** Opens the Factory sheet; with a recipe, "How many?" for it. */
  openFactory: (recipeId?: string) => void;
  /** The game clock now, in ms (the server's). */
  gameNow: () => number;
  /** Is this recipe book page open, as last read (the Factory only queues open pages)? */
  isPageOpen: (pageKey: string) => boolean;
  /** Ms until an ISO time on the server's clock (0 once it's passed), for countdowns. */
  msUntil: (iso: string) => number;
  readonly debug: InventoryDebug | null;
}

// Player-facing text (style guide §6, §9).
const TEXT = {
  bag: 'Bag',
  title: 'Your bag',
  close: 'Close',
  empty: 'Your bag is empty. Tap a spot on your land to gather!',
  makeTitle: 'Make things',
  makingTitle: 'Cooking',
  gatherTitle: 'Gathering',
  gather: 'Gather',
  make: 'Make',
  waiting: (left: string) => `Gathering… ready in ${left}`,
  making: (name: string, left: string) => `Making ${name}… ${left}`,
  busy: (left: string) => `Someone's gathering here. Ready in ${left}.`,
  busyDone: "Someone's gathering here.",
  gives: (what: string) => `Gives ${what}`,
  got: (what: string) => `Yay! ${what}`,
  started: 'Off you go! It pops into your bag when it’s ready.',
  keepsGoing: 'It keeps going while you play!',
  landing: 'Ready! Into your bag it goes…',
  readyNow: 'Ready!',
  chipWaiting: (what: string, left: string) => `Gathering ${what}… ready in ${left}`,
  chipReady: (what: string) => `${what} is ready!`,
  chipMore: (n: number) => ` (+${String(n)})`,
  craftBusy: 'Your pot is busy cooking!',
  justASec: 'Just a sec…',
  noMap: 'Visit a patch first!',
  devGrant: 'Get stuff (dev)',
  devFactory: 'Finish batches (dev)',
  findIt: 'Find it:',
} as const;

/** How long the "it landed!" pop-up stays. */
const TOAST_MS = 3200; // TUNE: long enough to read "🪵 +5 Timber!", short enough not to nag
/** A settle asks a moment after the server's `nextAt`, so it has surely finished by the server's clock. */
const SETTLE_SLACK_MS = 400; // TUNE: covers the clock sync's rounding and a slow request
/** A settle that failed (a flaky phone connection, a rate limit) tries once more after this long. */
const SETTLE_RETRY_MS = 5000; // TUNE: long enough for a radio to come back

/** Where the welcome-back card remembers when I last saw a patch (#294), per account and patch. */
const SEEN_KEY = (userId: string, mapId: string) => `heartpatch.factory.seen.${userId}.${mapId}`;

/** Things a dev build hands out to try crafting without waiting. */
const DEV_ITEMS: ItemCounts = {
  timber: 10,
  stone: 10,
  emberwood: 10,
  treats: 10,
  pumpkins: 6,
  'witch-dust': 3,
};

export function createInventoryScreen(options: InventoryScreenOptions): InventoryScreen {
  const api = options.api ?? inventoryApi;
  const fapi = options.factoryApi ?? factoryApi;
  const clock = new GameClock(options.now);
  const device = options.now ?? (() => Date.now());
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const readPages = options.openPages ?? (() => recipeBookApi.get().then((res) => res.unlocked));
  /** Recipe book pages this account has opened, as last read. */
  let openPages = new Set<string>();

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let state: InventoryResponse | null = null;
  /** Bumped by every map change, so a late reply can't land on another map. */
  let generation = 0;
  let working = false;
  let ticker: number | undefined;
  let panel: { container: HTMLElement; tile: PublicTile } | null = null;
  let shownAction: TileAction | null = null;
  let shownChip: InventoryDebug['chip'] = null;
  /** The one settle waiting for the next thing to finish (the server's `nextAt`). */
  let settleTimer: number | undefined;
  let toastTimer: number | undefined;
  let landings = 0;

  // ── Bag button and sheet ──────────────────────────────────────────────
  const open = el(
    'button',
    { type: 'button', class: 'bag-open', 'data-testid': 'bag-open', 'aria-label': TEXT.bag },
    el('span', { class: 'bag-open-icon', 'aria-hidden': 'true' }, '🎒'),
    el('span', { class: 'bag-open-label' }, TEXT.bag),
  );
  open.hidden = true;

  // The gathering chip: a gather takes minutes on a patch, so the map keeps
  // saying so until it lands in the bag, then it's gone. A tap opens the Bag.
  const chip = el('button', {
    type: 'button',
    class: 'gather-chip',
    'data-testid': 'gather-chip',
  });
  chip.hidden = true;

  const close = el(
    'button',
    { type: 'button', class: 'tile-panel-close', 'aria-label': TEXT.close },
    '×',
  );
  const note = el('p', { class: 'bag-note', role: 'status', 'data-testid': 'bag-note' });
  const itemsBox = el('ul', { class: 'bag-items', 'data-testid': 'bag-items' });
  // What a tapped item is for (#241): one card under the grid; tap again to close.
  const detailBox = el('div', { class: 'bag-detail', 'data-testid': 'bag-detail' });
  detailBox.hidden = true;
  let picked: string | null = null;
  const gathersTitle = el('h3', { class: 'bag-section-title' }, TEXT.gatherTitle);
  const gathersBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-gathers' });
  // The Crafting Factory's batches (#294): a strip under the items; a tap opens its sheet.
  const factoryStrip = createFactoryStrip(
    () => clock.now(),
    () => {
      openFactory();
    },
  );
  const craftsTitle = el('h3', { class: 'bag-section-title' }, TEXT.makingTitle);
  const craftsBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-crafts' });
  const recipesBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-recipes' });
  const sheet = el(
    'section',
    { class: 'bag', 'data-testid': 'bag', role: 'dialog', 'aria-labelledby': 'bag-title' },
    el('div', { class: 'tile-panel-head' }, el('h2', { id: 'bag-title' }, TEXT.title), close),
    note,
    itemsBox,
    detailBox,
    factoryStrip.element,
    craftsTitle,
    craftsBox,
    gathersTitle,
    gathersBox,
    el('h3', { class: 'bag-section-title' }, TEXT.makeTitle),
    recipesBox,
  );
  sheet.hidden = true;
  // The "it landed!" pop-up: one cheerful line for everything that just
  // went into the bag, wherever the player is looking (the book included).
  const toast = el('p', {
    class: 'landed-toast',
    role: 'status',
    'data-testid': 'landed-toast',
  });
  toast.hidden = true;

  // The Factory sheet (#294): the queue panel over the map or the Bag.
  const factoryPanel = createFactoryPanel({
    now: () => clock.now(),
    start: (recipeId, count) => startBatch(recipeId, count),
    stop: (batchId) => stopBatch(batchId),
    isOpen: (key) => openPages.has(key),
  });
  const factoryClose = el(
    'button',
    {
      type: 'button',
      class: 'tile-panel-close',
      'aria-label': TEXT.close,
      'data-testid': 'factory-close',
    },
    '×',
  );
  const factorySheet = el(
    'section',
    {
      class: 'bag factory-sheet',
      'data-testid': 'factory-sheet',
      role: 'dialog',
      'aria-labelledby': 'factory-title',
    },
    el(
      'div',
      { class: 'tile-panel-head' },
      el('h2', { id: 'factory-title' }, `🏭 ${FACTORY_TEXT.name}`),
      factoryClose,
    ),
    factoryPanel.element,
  );
  factorySheet.hidden = true;
  factoryClose.addEventListener('click', () => {
    factorySheet.hidden = true;
    factoryPanel.pause();
    render();
  });

  // Welcome back (#294, owner decision 2026-10-08): after a while away, what
  // the Factory made, in one card. Everything is in the bag already.
  const welcomeGot = el('div', {
    class: 'factory-welcome-got',
    'data-testid': 'factory-welcome-got',
  });
  const welcomeStill = el('ul', { class: 'factory-stop-lines' });
  const welcomeOk = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'factory-welcome-ok' },
    FACTORY_TEXT.ok,
  );
  const welcomeSee = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'factory-welcome-see' },
    FACTORY_TEXT.seeFactory,
  );
  const welcome = el(
    'div',
    { class: 'factory-welcome', 'data-testid': 'factory-welcome' },
    el(
      'section',
      { class: 'factory-welcome-card', role: 'dialog', 'aria-labelledby': 'factory-welcome-title' },
      el('div', { 'aria-hidden': 'true', style: 'font-size:44px;line-height:1' }, '🏭'),
      el('h2', { id: 'factory-welcome-title' }, FACTORY_TEXT.welcomeTitle),
      el('p', { class: 'factory-about' }, FACTORY_TEXT.welcomeLine),
      welcomeGot,
      welcomeStill,
      el('div', { class: 'factory-row' }, welcomeOk, ...(options.onSeeFactory ? [welcomeSee] : [])),
    ),
  );
  welcome.hidden = true;
  welcomeOk.addEventListener('click', () => {
    welcome.hidden = true;
  });
  welcomeSee.addEventListener('click', () => {
    welcome.hidden = true;
    options.onSeeFactory?.();
  });

  (options.entryRoot ?? options.root).append(open);
  options.root.append(chip, sheet, factorySheet, toast, welcome);

  if (options.devTools) {
    const dev = el(
      'button',
      { type: 'button', class: 'auth-button auth-button-soft auth-button-small' },
      TEXT.devGrant,
    );
    dev.addEventListener('click', () => {
      void act(async (id) => {
        const items = await api.dev.grant(id, DEV_ITEMS);
        if (state) state = { ...state, items };
        say(TEXT.got(describeItems(DEV_ITEMS)));
        options.onCollected?.();
      });
    });
    const devFactory = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft auth-button-small',
        'data-testid': 'factory-dev-ready',
      },
      TEXT.devFactory,
    );
    devFactory.addEventListener('click', () => {
      void act(async (id, at) => {
        const res = await fapi.dev.ready(id);
        apply(at, res);
        await refresh();
      });
    });
    sheet.append(dev, devFactory);
  }

  const openBag = () => {
    sheet.hidden = false;
    render();
    void refresh();
  };
  open.addEventListener('click', openBag);
  chip.addEventListener('click', openBag);
  close.addEventListener('click', () => {
    sheet.hidden = true;
    picked = null;
    say('');
    render();
  });

  const say = (text: string) => {
    note.textContent = text;
  };

  // ── Server calls ──────────────────────────────────────────────────────

  /** Applies a reply for the map still on screen; drops it otherwise. */
  const apply = (at: number, next: Partial<InventoryResponse> & { now: string }): boolean => {
    if (at !== generation || !state) return false;
    clock.sync(next.now);
    state = { ...state, ...next };
    return true;
  };

  /** When the server last said the next thing finishes (its `nextAt`; gatherers' cycles included). */
  let serverNextAt: string | null = null;
  /** The last settle failed and its one retry is spent (reset by a settle that works). */
  let retried = false;
  /** Bumped by every settle sent, so an older reply can't put an older bag back. */
  let settlesSent = 0;

  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    settlesSent += 1;
    const sent = settlesSent;
    try {
      const { landed, trained, nextAt, ...fresh } = await api.settle(id);
      if (at !== generation) return;
      // A newer settle went out meanwhile: its bag wins, but what this one
      // banked still pops up (the server put it in the bag).
      const newest = sent === settlesSent;
      if (newest) {
        clock.sync(fresh.now);
        state = fresh;
        serverNextAt = nextAt;
      }
      const away = awayMs(id);
      if (landed.length > 0 || trained.length > 0) {
        landings += 1;
        // After a while away, the Factory's things get their own card (#294).
        const card = showsWelcomeBack(landed, away);
        if (card) showWelcome(landed);
        const popped = card ? landed.filter((l) => l.kind !== 'factory') : landed;
        showToast([landedText(popped), trainedText(trained)].filter((t) => t !== '').join(' '));
        if (landed.length > 0) options.onCollected?.();
      }
      // Only while the kid can see it: a tab left open in the background
      // keeps settling, and that isn't being here.
      if (document.visibilityState === 'visible') markSeen(id);
      if (!newest) return;
      render();
      scheduleSettle();
    } catch (err) {
      if (at !== generation) return;
      say(messageOf(err));
      // Once more in a moment, so a finished thing doesn't sit at "ready!" until
      // the app is reopened; after that, the next open, Bag or return asks.
      if (!retried) {
        retried = true;
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          settleTimer = undefined;
          void refresh();
        }, SETTLE_RETRY_MS);
      }
      return;
    }
    retried = false;
  }

  /**
   * One settle, timed for the next thing to finish: the server's `nextAt`,
   * or a craft or gather started since. Never sooner than the slack, so a
   * clock a few ms apart can't make it ask in a loop.
   */
  function scheduleSettle(): void {
    window.clearTimeout(settleTimer);
    settleTimer = undefined;
    if (!mapId || !state) return;
    const due = [
      ...(serverNextAt ? [serverNextAt] : []),
      ...state.crafts.map((c) => c.readyAt),
      ...state.gathers.map((g) => g.readyAt),
      ...(state.factory?.batches.flatMap((b) => (b.nextAt ? [b.nextAt] : [])) ?? []),
    ].map((iso) => clock.msUntil(iso));
    if (due.length === 0) return;
    const wait = Math.min(...due) + SETTLE_SLACK_MS;
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      void refresh();
    }, wait);
  }

  /** How long since this patch was last on screen (device clock; Infinity when never seen here). */
  function awayMs(id: string): number {
    if (!user || !storage) return 0;
    try {
      const raw = storage.getItem(SEEN_KEY(user.id, id));
      const at = raw === null ? NaN : Number(raw);
      return Number.isFinite(at) ? device() - at : 0;
    } catch {
      return 0;
    }
  }
  function markSeen(id: string): void {
    if (!user || !storage) return;
    try {
      storage.setItem(SEEN_KEY(user.id, id), String(device()));
    } catch {
      // Private mode: no welcome-back card, the pop-up still says what landed.
    }
  }

  function showWelcome(landed: readonly Landed[]): void {
    welcomeGot.replaceChildren(...welcomeChips(landed).map((c) => el('span', {}, c)));
    const going = state?.factory
      ? batchRows(state.factory, clock.now()).filter((r) => !r.finished)
      : [];
    welcomeStill.replaceChildren(
      ...going.map((r) =>
        el('li', {}, `${r.icon} ${FACTORY_TEXT.stillGoing(r.name, r.done, r.total)}`),
      ),
    );
    welcomeStill.hidden = going.length === 0;
    welcome.hidden = false;
    welcomeOk.focus();
  }

  const showToast = (text: string) => {
    if (text === '') return;
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(hideToast, TOAST_MS);
  };
  const hideToast = () => {
    window.clearTimeout(toastTimer);
    toastTimer = undefined;
    toast.hidden = true;
    toast.textContent = '';
  };
  const stopSettling = () => {
    window.clearTimeout(settleTimer);
    settleTimer = undefined;
    serverNextAt = null;
    retried = false;
    hideToast();
  };

  // Back from another app or a locked screen: things may have finished meanwhile.
  // Going away is remembered, for the welcome-back card (#294).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mapId) void refresh();
    else if (document.visibilityState === 'hidden' && mapId) markSeen(mapId);
  });

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  /**
   * Runs one command for the map on screen, one at a time. A `CONFLICT`
   * (still cooking, something changed) settles and refetches, so the buttons
   * match the server again.
   */
  /** Resolves to null when it ran, or to the line it said about why not. */
  async function act(
    run: (
      mapId: string,
      at: number,
      send: <T>(command: (key: string) => Promise<T>) => Promise<T | null>,
    ) => Promise<void>,
  ): Promise<string | null> {
    const id = mapId;
    if (!id) return TEXT.noMap;
    if (working) return TEXT.justASec;
    let failure: string | null = null;
    const at = generation;
    working = true;
    render();
    try {
      await run(id, at, (command) => sendCommand(sendDeps, command, () => at === generation));
    } catch (err) {
      failure = messageOf(err);
      if (at === generation) {
        say(failure);
        if (err instanceof ApiRequestError && err.code === 'CONFLICT') await refresh();
      }
    } finally {
      working = false;
      if (at === generation) render();
    }
    return failure;
  }

  const startGather = (tile: PublicTile) =>
    act(async (id, at, send) => {
      const res = await send((key) => api.gather(id, { q: tile.q, r: tile.r }, key));
      if (!res || !state || !apply(at, { now: res.now })) return;
      // A finished gather on this node went in the bag as this one started.
      const banked = state.gathers.find((g) => g.q === tile.q && g.r === tile.r);
      state = {
        ...state,
        gathers: [...state.gathers.filter((g) => g.q !== tile.q || g.r !== tile.r), res.gather],
      };
      say(TEXT.started);
      scheduleSettle();
      if (banked) {
        // The server banked it (the reply has no bag): say so, and read the bag again.
        landings += 1;
        showToast(landedText([banked]));
        options.onCollected?.();
        void refresh();
      }
    });

  const startCraft = (recipeId: string) =>
    act(async (id, at, send) => {
      const res = await send((key) => api.craft(id, recipeId, key));
      if (!res || !state || !apply(at, { now: res.now, items: res.items })) return;
      // A finished craft went in the bag first (the server frees the pot), so
      // the one just started is the only one cooking.
      const banked = state.crafts;
      state = { ...state, crafts: [res.craft] };
      say('');
      scheduleSettle();
      if (banked.length > 0) {
        landings += 1;
        showToast(landedText(banked));
        options.onCollected?.();
      }
    });

  /** A Crafting Factory batch (#294): the reply is the whole bag, batches included. */
  const startBatch = (recipeId: string, count: number) =>
    act(async (id, at, send) => {
      const res = await send((key) => fapi.start(id, recipeId, count, key));
      if (!res || !apply(at, res)) return;
      say('');
      scheduleSettle();
    });

  const stopBatch = (batchId: string) =>
    act(async (id, at, send) => {
      const res = await send((key) => fapi.stop(id, batchId, key));
      if (!res || !apply(at, res)) return;
      say('');
      showToast(landedText([{ items: res.refunded }]));
      scheduleSettle();
    });

  /** Reads which recipe book pages are open (for the picker); keeps what it knew on failure. */
  async function loadPages(): Promise<void> {
    try {
      openPages = new Set(await readPages());
      renderFactory();
    } catch {
      // The picker shows what it knew.
    }
  }

  function openFactory(recipeId?: string): void {
    if (!state?.factory) return;
    factorySheet.hidden = false;
    renderFactory();
    if (recipeId) factoryPanel.pick(recipeId);
    else factoryPanel.showList();
    void loadPages().then(() => {
      if (recipeId && factoryPanel.mode === 'pick') factoryPanel.pick(recipeId);
    });
  }

  function renderFactory(): void {
    const view = state?.factory ?? null;
    factoryStrip.update(sheet.hidden ? null : view);
    if (factorySheet.hidden || !state || !view) {
      if (!view) factorySheet.hidden = true;
      return;
    }
    factoryPanel.update({ view, items: state.items, seasons: state.seasons });
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  const button = (label: string, onTap: () => void, extra: Record<string, string> = {}) => {
    const b = el('button', { type: 'button', class: 'auth-button bag-action', ...extra }, label);
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  /**
   * A countdown on screen. Rows and buttons are built only when the data
   * changes; the once-a-second tick only rewrites these texts, so a finger
   * resting on a button never has it swapped out from under it. The words
   * are one Text node kept for the countdown's life and rewritten in place
   * (`data`), never replaced: WebKit pairs a pointer's release with the very
   * node its press landed on, which for a label is its Text node, and fires
   * no click when that node is gone by the release (a `textContent` rewrite
   * swaps it). A trackpad or mouse on an iPad, Safari on a Mac and CI's
   * mouse all lost the gather chip's click whenever a tick fell inside the
   * press; a finger on iOS presses and lifts in one go and never did. When
   * one reaches zero, the screen redraws once (its button appears).
   */
  interface Countdown {
    text: Text;
    readyAt: string;
    say: (left: string) => string;
  }
  let bagCountdowns: Countdown[] = [];
  let tileCountdowns: Countdown[] = [];
  let chipCountdowns: Countdown[] = [];

  const countdown = (
    list: Countdown[],
    tag: 'span' | 'p',
    cls: string,
    readyAt: string,
    say: (left: string) => string,
  ): HTMLElement => {
    const text = document.createTextNode(say(formatTimeLeft(clock.msUntil(readyAt))));
    list.push({ text, readyAt, say });
    return el(tag, { class: cls }, text);
  };

  function renderDetail(item: { id: string; count: number } | null): void {
    if (!item) picked = null;
    detailBox.hidden = item === null;
    if (!item) {
      detailBox.replaceChildren();
      return;
    }
    const d = itemDetail(item.id, item.count);
    detailBox.replaceChildren(
      el(
        'div',
        { class: 'bag-detail-head' },
        el('span', { class: 'bag-detail-icon', 'aria-hidden': 'true' }, d.icon),
        el(
          'span',
          { class: 'bag-detail-title' },
          el('strong', {}, d.name),
          el('span', { class: 'bag-detail-have' }, d.have),
        ),
      ),
      el('p', { class: 'bag-detail-purpose' }, d.purpose),
      el(
        'div',
        { class: 'bag-chips' },
        ...d.chips.map((c) =>
          el('span', { class: c.battle ? 'bag-chip bag-chip-battle' : 'bag-chip' }, c.text),
        ),
      ),
      ...(d.where
        ? [el('p', { class: 'bag-detail-where' }, el('b', {}, TEXT.findIt), ` ${d.where}`)]
        : []),
    );
  }

  function renderBag(): void {
    bagCountdowns = [];
    if (sheet.hidden || !state) return;

    const items = bagItems(state.items);
    itemsBox.replaceChildren(
      ...(items.length === 0
        ? [el('li', { class: 'bag-empty' }, TEXT.empty)]
        : items.map((item) => {
            const tile = el(
              'button',
              {
                type: 'button',
                class: 'bag-item',
                'data-item': item.id,
                'aria-pressed': String(item.id === picked),
              },
              el('span', { class: 'bag-item-icon', 'aria-hidden': 'true' }, item.icon),
              el('span', { class: 'bag-item-count' }, String(item.count)),
              el('span', { class: 'bag-item-name' }, item.name),
            );
            tile.addEventListener('click', () => {
              picked = picked === item.id ? null : item.id;
              render();
              // The grid was redrawn: keep focus on the tile that was tapped.
              itemsBox.querySelector<HTMLElement>(`[data-item="${item.id}"]`)?.focus();
              // On a phone the card can open below the fold: bring it up.
              if (picked !== null) detailBox.scrollIntoView({ block: 'nearest' });
            });
            return el('li', { class: 'bag-cell' }, tile);
          })),
    );
    renderDetail(items.find((i) => i.id === picked) ?? null);

    gathersTitle.hidden = state.gathers.length === 0;
    gathersBox.replaceChildren(
      ...state.gathers.map((g) => {
        const label = `${itemIcon(g.resource)} ${itemName(g.resource)}`;
        return el(
          'li',
          { class: 'bag-row' },
          el('span', { class: 'bag-row-name' }, label),
          clock.msUntil(g.readyAt) > 0
            ? countdown(bagCountdowns, 'span', 'bag-row-wait', g.readyAt, (left) => left)
            : el('span', { class: 'bag-row-wait' }, TEXT.readyNow),
        );
      }),
    );

    // Every craft on the go, whatever its recipe or season (the recipe book
    // shows the one cooking too); a finished one lands by itself.
    craftsTitle.hidden = state.crafts.length === 0;
    craftsBox.replaceChildren(
      ...bagCrafts(state.crafts).map(({ craft, name, icon }) =>
        el(
          'li',
          { class: 'bag-row', 'data-craft': craft.id },
          el('span', { class: 'bag-row-name' }, `${icon} ${name}`),
          clock.msUntil(craft.readyAt) > 0
            ? countdown(bagCountdowns, 'span', 'bag-row-wait', craft.readyAt, (left) =>
                TEXT.making(name, left),
              )
            : el('span', { class: 'bag-row-wait' }, TEXT.readyNow),
        ),
      ),
    );

    // Only a craft still cooking keeps the pot busy: a finished one is
    // banked as the next one starts (the server frees the pot).
    const cooking = state.crafts.filter((c) => clock.msUntil(c.readyAt) > 0);
    recipesBox.replaceChildren(
      ...bagRecipes(state.items, cooking, state.seasons).map(({ recipe, icon, cost, state: s }) => {
        let action: Node;
        // The Factory (#294): "🏭 Queue" beside Make, once one is built.
        const queue =
          state?.factory && s.kind !== 'sleeping' && s.kind !== 'short'
            ? [
                button(
                  FACTORY_TEXT.queue,
                  () => {
                    openFactory(recipe.id);
                  },
                  { 'data-queue': recipe.id, class: 'auth-button-soft' },
                ),
              ]
            : [];
        if (s.kind === 'ready') {
          action = el(
            'span',
            { class: 'bag-row-actions' },
            button(TEXT.make, () => void startCraft(recipe.id), {
              'data-recipe': recipe.id,
            }),
            ...queue,
          );
        } else if (s.kind === 'busy' && queue.length > 0) {
          action = el(
            'span',
            { class: 'bag-row-actions' },
            el('span', { class: 'bag-row-note' }, TEXT.craftBusy),
            ...queue,
          );
        } else {
          action = el(
            'span',
            { class: 'bag-row-note' },
            s.kind === 'busy' ? TEXT.craftBusy : s.note,
          );
        }
        return el(
          'li',
          { class: 'bag-row', 'data-recipe-row': recipe.id },
          el(
            'span',
            { class: 'bag-row-name' },
            `${icon} ${recipe.name}`,
            el('span', { class: 'bag-row-cost' }, cost),
          ),
          action,
        );
      }),
    );
  }

  function renderTile(): void {
    shownAction = null;
    tileCountdowns = [];
    if (!panel) return;
    const { container, tile } = panel;
    if (!state) {
      container.replaceChildren();
      return;
    }
    const action = tileAction(tile, user?.id ?? null, state, clock.now());
    shownAction = action;
    const line = (text: string) => el('p', { class: 'tile-action-note' }, text);
    switch (action.kind) {
      case 'none':
        container.replaceChildren();
        break;
      case 'gather':
        container.replaceChildren(
          line(TEXT.gives(describeItems(action.yields))),
          button(TEXT.gather, () => void startGather(tile), { 'data-testid': 'tile-gather' }),
        );
        break;
      case 'waiting': {
        const left = countdown(
          tileCountdowns,
          'p',
          'tile-action-note tile-action-waiting',
          action.gather.readyAt,
          TEXT.waiting,
        );
        left.dataset['testid'] = 'tile-gathering';
        container.replaceChildren(left, line(TEXT.keepsGoing));
        break;
      }
      case 'landing': {
        const landing = line(TEXT.landing);
        landing.dataset['testid'] = 'tile-landing';
        container.replaceChildren(line(TEXT.gives(describeItems(action.gather.items))), landing);
        break;
      }
      case 'sleeping':
        container.replaceChildren(line(action.note));
        break;
      case 'busy':
        container.replaceChildren(
          clock.msUntil(action.readyAt) > 0
            ? countdown(tileCountdowns, 'p', 'tile-action-note', action.readyAt, TEXT.busy)
            : line(TEXT.busyDone),
        );
        break;
    }
  }

  /** The gathering chip, while something's gathering and the Bag is shut. */
  function renderChip(): void {
    chipCountdowns = [];
    chip.disabled = working;
    const shown = mapId !== null && state !== null && sheet.hidden;
    const model = shown && state ? gatherChip(state.gathers, (iso) => clock.msUntil(iso)) : null;
    shownChip = model ? (model.ready ? 'ready' : 'waiting') : null;
    chip.hidden = model === null;
    if (!model) return;
    const { gather } = model;
    const what = `${itemIcon(gather.resource)} ${itemName(gather.resource)}`;
    const more = model.more > 0 ? TEXT.chipMore(model.more) : '';
    chip.classList.toggle('gather-chip-ready', model.ready);
    chip.replaceChildren(
      model.ready
        ? `${TEXT.chipReady(what)}${more}`
        : countdown(
            chipCountdowns,
            'span',
            'gather-chip-text',
            gather.readyAt,
            (left) => `${TEXT.chipWaiting(what, left)}${more}`,
          ),
    );
  }

  function render(): void {
    open.hidden = mapId === null;
    renderBag();
    renderFactory();
    renderTile();
    renderChip();
    syncTicker();
  }

  /** One tick: rewrite countdown texts; redraw only when one has finished. */
  function tick(): void {
    let finished = false;
    for (const c of [...bagCountdowns, ...tileCountdowns, ...chipCountdowns]) {
      const left = clock.msUntil(c.readyAt);
      if (left <= 0) finished = true;
      else c.text.data = c.say(formatTimeLeft(left));
    }
    if (finished) render();
  }

  /** Ticks once a second only while a countdown is on screen. */
  function syncTicker(): void {
    const counting = bagCountdowns.length + tileCountdowns.length + chipCountdowns.length > 0;
    if (counting && ticker === undefined) {
      ticker = window.setInterval(tick, 1000);
    } else if (!counting && ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  }

  return {
    setMap: async (next) => {
      if (next === mapId) return;
      generation += 1;
      mapId = next;
      state = null;
      sheet.hidden = true;
      factorySheet.hidden = true;
      stopSettling();
      say('');
      render();
      if (next) await refresh();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      mapId = null;
      state = null;
      sheet.hidden = true;
      stopSettling();
      render();
    },
    get bag() {
      return state;
    },
    refresh,
    craft: (recipeId) => startCraft(recipeId),
    queue: (recipeId, count) => startBatch(recipeId, count),
    stopBatch: (batchId) => stopBatch(batchId),
    openFactory,
    gameNow: () => clock.now(),
    isPageOpen: (key) => openPages.has(key),
    msUntil: (iso) => clock.msUntil(iso),
    tileActions: {
      show: (container, tile) => {
        panel = { container, tile };
        render();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
        shownAction = null;
        render();
      },
    },
    get debug() {
      if (!mapId || !state) return null;
      return {
        mapId,
        items: { ...state.items },
        gathers: state.gathers.length,
        crafts: state.crafts.length,
        seasons: [...state.seasons],
        bagOpen: !sheet.hidden,
        tileAction: shownAction?.kind ?? null,
        chip: shownChip,
        toast: toast.hidden ? null : toast.textContent,
        landings,
        batches: state.factory ? state.factory.batches.length : null,
        factorySheet: factorySheet.hidden ? null : factoryPanel.mode,
        welcome: !welcome.hidden,
      };
    },
  };
}

/** `localStorage`, or null where it throws (private mode, blocked site data). */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
