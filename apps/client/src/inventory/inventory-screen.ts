import type { InventoryResponse, ItemCounts, PublicTile, PublicUser } from '@heartpatch/shared';
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
} from './bag-view.js';
import { formatTimeLeft, GameClock } from './game-clock.js';
import { inventoryApi, type InventoryApi } from './inventory-api.js';
import { itemIcon } from './item-icons.js';
import { COMMAND_RETRY_MS, sendCommand } from './send-command.js';
import { tileAction, type TileAction } from './tile-action.js';
import './inventory.css';

// The bag and gathering (#17, design doc §12): a Bag entry in the My Heartpatch tray that
// opens a sheet of items (big numbers, pictures) and recipes, and the
// gather / collect button inside the map's tile panel. Timers are the
// server's timestamps; the screen only counts down to them on the game clock
// and asks the server to do everything (CLAUDE.md rule 1).

export interface InventoryScreenOptions {
  root: HTMLElement;
  /** Where the entry button goes (a tray over the map, ui/trays); defaults to `root`. */
  entryRoot?: HTMLElement;
  api?: InventoryApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
  /** Dev builds show a "get stuff" button (server `HP_DEV_SQUISHY_GRANTS`). */
  devTools?: boolean;
  /** Something new landed in the bag (a gather or craft collected): the recipe book may open a page. */
  onCollected?: () => void;
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
  /** The gathering chip over the map: null while hidden; `got` while it shows what a tap collected. */
  readonly chip: 'waiting' | 'ready' | 'got' | null;
}

export interface InventoryScreen {
  /** The map on screen (null: none): shows the Bag button and loads the bag. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  readonly tileActions: TileActions;
  /** The bag on screen now (items, crafts, seasons), or null. */
  readonly bag: InventoryResponse | null;
  /** Fetches the bag again for the map on screen. */
  refresh: () => Promise<void>;
  /**
   * Starts a craft for the map on screen (the recipe book's "Make it"): the
   * server checks and takes the items (CLAUDE.md rule 1). Resolves to null
   * once started, or to a kid-readable line saying why not.
   */
  craft: (recipeId: string) => Promise<string | null>;
  /** Collects a finished craft (the recipe book's Collect), like the Bag's. Null once collected, or why not. */
  collectCraft: (craftId: string) => Promise<string | null>;
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
  collect: 'Collect',
  make: 'Make',
  waiting: (left: string) => `Gathering… ready in ${left}`,
  making: (name: string, left: string) => `Making ${name}… ${left}`,
  busy: (left: string) => `Someone's gathering here. Ready in ${left}.`,
  busyDone: "Someone's gathering here.",
  gives: (what: string) => `Gives ${what}`,
  got: (what: string) => `Yay! ${what}`,
  started: 'Off you go! Come back when it’s ready.',
  keepsGoing: 'It keeps going while you play!',
  chipWaiting: (what: string, left: string) => `Gathering ${what}… ready in ${left}`,
  chipReady: (what: string) => `${what} is ready! Tap to collect`,
  chipMore: (n: number) => ` (+${String(n)})`,
  craftBusy: 'Your pot is busy! Collect first.',
  justASec: 'Just a sec…',
  noMap: 'Visit a patch first!',
  devGrant: 'Get stuff (dev)',
} as const;

/** How long the chip shows what a tap just collected before it moves on. */
const CHIP_REVEAL_MS = 2500; // TUNE: long enough to read "Yay! +5 Timber", short enough not to nag

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
  const clock = new GameClock(options.now);

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
  /** The gather the chip offers to collect on tap (null while it only counts down). */
  let chipReady: string | null = null;
  /** What the chip's own tap just collected, shown on the chip for a moment. */
  let chipReveal: string | null = null;
  let chipRevealTimer: number | undefined;

  // ── Bag button and sheet ──────────────────────────────────────────────
  const open = el(
    'button',
    { type: 'button', class: 'bag-open', 'data-testid': 'bag-open', 'aria-label': TEXT.bag },
    el('span', { class: 'bag-open-icon', 'aria-hidden': 'true' }, '🎒'),
    el('span', { class: 'bag-open-label' }, TEXT.bag),
  );
  open.hidden = true;

  // The gathering chip: a gather takes minutes on a patch, so the map keeps
  // saying so until it's collected. Tap while it counts down: the Bag. Tap
  // once it says "ready! Tap to collect": it collects, and shows what came
  // (one tap does what the label says; the owner's playtest of 2026-10-05).
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
  const gathersTitle = el('h3', { class: 'bag-section-title' }, TEXT.gatherTitle);
  const gathersBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-gathers' });
  const craftsTitle = el('h3', { class: 'bag-section-title' }, TEXT.makingTitle);
  const craftsBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-crafts' });
  const recipesBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-recipes' });
  const sheet = el(
    'section',
    { class: 'bag', 'data-testid': 'bag', role: 'dialog', 'aria-labelledby': 'bag-title' },
    el('div', { class: 'tile-panel-head' }, el('h2', { id: 'bag-title' }, TEXT.title), close),
    note,
    itemsBox,
    craftsTitle,
    craftsBox,
    gathersTitle,
    gathersBox,
    el('h3', { class: 'bag-section-title' }, TEXT.makeTitle),
    recipesBox,
  );
  sheet.hidden = true;
  (options.entryRoot ?? options.root).append(open);
  options.root.append(chip, sheet);

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
    sheet.append(dev);
  }

  const openBag = () => {
    sheet.hidden = false;
    render();
    void refresh();
  };
  open.addEventListener('click', openBag);
  chip.addEventListener('click', () => {
    if (chipReady) void collectGather(chipReady, 'chip');
    else openBag();
  });
  close.addEventListener('click', () => {
    sheet.hidden = true;
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

  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    try {
      const fresh = await api.get(id);
      if (at !== generation) return;
      clock.sync(fresh.now);
      state = fresh;
      render();
    } catch (err) {
      if (at === generation) say(messageOf(err));
    }
  }

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  /**
   * Runs one command for the map on screen, one at a time. A `CONFLICT`
   * (already collected, not ready, something changed) refetches, so the
   * buttons match the server again.
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
      if (!res || !apply(at, { now: res.now })) return;
      state = state && { ...state, gathers: [...state.gathers, res.gather] };
      say(TEXT.started);
    });

  const collectGather = (gatherId: string, from: 'panel' | 'chip' = 'panel') =>
    act(async (id, at, send) => {
      const res = await send((key) => api.collectGather(id, gatherId, key));
      if (!res || !state || !apply(at, { now: res.now, items: res.items })) return;
      state = { ...state, gathers: state.gathers.filter((g) => g.id !== gatherId) };
      const got = TEXT.got(describeItems(res.granted));
      say(got);
      if (from === 'chip') revealOnChip(got);
      options.onCollected?.();
    });

  /** The chip shows what its tap collected for a moment, then moves on. */
  const revealOnChip = (text: string) => {
    chipReveal = text;
    window.clearTimeout(chipRevealTimer);
    chipRevealTimer = window.setTimeout(() => {
      chipRevealTimer = undefined;
      chipReveal = null;
      render();
    }, CHIP_REVEAL_MS);
  };
  const clearChipReveal = () => {
    window.clearTimeout(chipRevealTimer);
    chipRevealTimer = undefined;
    chipReveal = null;
  };

  const startCraft = (recipeId: string) =>
    act(async (id, at, send) => {
      const res = await send((key) => api.craft(id, recipeId, key));
      if (!res || !state || !apply(at, { now: res.now, items: res.items })) return;
      state = { ...state, crafts: [...state.crafts, res.craft] };
      say('');
    });

  const collectCraft = (craftId: string) =>
    act(async (id, at, send) => {
      const res = await send((key) => api.collectCraft(id, craftId, key));
      if (!res || !state || !apply(at, { now: res.now, items: res.items })) return;
      state = { ...state, crafts: state.crafts.filter((c) => c.id !== craftId) };
      say(TEXT.got(describeItems(res.granted)));
      options.onCollected?.();
    });

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

  function renderBag(): void {
    bagCountdowns = [];
    if (sheet.hidden || !state) return;

    const items = bagItems(state.items);
    itemsBox.replaceChildren(
      ...(items.length === 0
        ? [el('li', { class: 'bag-empty' }, TEXT.empty)]
        : items.map((item) =>
            el(
              'li',
              { class: 'bag-item', 'data-item': item.id },
              el('span', { class: 'bag-item-icon', 'aria-hidden': 'true' }, item.icon),
              el('span', { class: 'bag-item-count' }, String(item.count)),
              el('span', { class: 'bag-item-name' }, item.name),
            ),
          )),
    );

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
            : button(TEXT.collect, () => void collectGather(g.id), {
                'data-testid': 'bag-collect',
              }),
        );
      }),
    );

    // Every craft on the go, whatever its recipe or season, with its Collect:
    // the one place that always offers it (the recipe book shows it too).
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
            : button(TEXT.collect, () => void collectCraft(craft.id), {
                'data-testid': 'bag-craft-collect',
              }),
        ),
      ),
    );

    recipesBox.replaceChildren(
      ...bagRecipes(state.items, state.crafts, state.seasons).map(
        ({ recipe, icon, cost, state: s }) => {
          let action: Node;
          if (s.kind === 'ready') {
            action = button(TEXT.make, () => void startCraft(recipe.id), {
              'data-recipe': recipe.id,
            });
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
        },
      ),
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
      case 'collect':
        container.replaceChildren(
          line(TEXT.gives(describeItems(action.gather.items))),
          button(TEXT.collect, () => void collectGather(action.gather.id), {
            'data-testid': 'tile-collect',
          }),
        );
        break;
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
    chipReady = null;
    chip.disabled = working;
    const shown = mapId !== null && state !== null && sheet.hidden;
    if (shown && chipReveal) {
      // What the chip's tap just collected.
      shownChip = 'got';
      chip.hidden = false;
      chip.classList.add('gather-chip-ready');
      chip.replaceChildren(chipReveal);
      return;
    }
    const model = shown && state ? gatherChip(state.gathers, (iso) => clock.msUntil(iso)) : null;
    shownChip = model ? (model.ready ? 'ready' : 'waiting') : null;
    chip.hidden = model === null;
    if (!model) return;
    const { gather } = model;
    if (model.ready) chipReady = gather.id;
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
      clearChipReveal();
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
      clearChipReveal();
      render();
    },
    get bag() {
      return state;
    },
    refresh,
    craft: (recipeId) => startCraft(recipeId),
    collectCraft: (craftId) => collectCraft(craftId),
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
      };
    },
  };
}
