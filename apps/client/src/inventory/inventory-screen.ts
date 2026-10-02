import type { InventoryResponse, ItemCounts, PublicTile, PublicUser } from '@heartpatch/shared';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { bagItems, bagRecipes, describeItems, itemName } from './bag-view.js';
import { formatTimeLeft, GameClock } from './game-clock.js';
import { inventoryApi, type InventoryApi } from './inventory-api.js';
import { itemIcon } from './item-icons.js';
import { tileAction, type TileAction } from './tile-action.js';
import './inventory.css';

// The bag and gathering (#17, design doc §12): a Bag button over the map that
// opens a sheet of items (big numbers, pictures) and recipes, and the
// gather / collect button inside the map's tile panel. Timers are the
// server's timestamps; the screen only counts down to them on the game clock
// and asks the server to do everything (CLAUDE.md rule 1).

export interface InventoryScreenOptions {
  root: HTMLElement;
  api?: InventoryApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
  /** Dev builds show a "get stuff" button (server `HP_DEV_SQUISHY_GRANTS`). */
  devTools?: boolean;
}

/** What the map screen's tile panel calls (map-screen.ts `TileActions`). */
export interface TileActionsSlot {
  /** The panel shows `tile`: draw its actions into `container`. */
  show: (container: HTMLElement, tile: PublicTile) => void;
  /** The panel closed. */
  hide: () => void;
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
}

export interface InventoryScreen {
  /** The map on screen (null: none): shows the Bag button and loads the bag. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  readonly tileActions: TileActionsSlot;
  readonly debug: InventoryDebug | null;
}

// Player-facing text (style guide §6, §9).
const TEXT = {
  bag: 'Bag',
  title: 'Your bag',
  close: 'Close',
  empty: 'Your bag is empty. Tap a spot on your land to gather!',
  makeTitle: 'Make things',
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
  craftBusy: 'Busy making something else.',
  devGrant: 'Get stuff (dev)',
} as const;

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

  // ── Bag button and sheet ──────────────────────────────────────────────
  const open = el(
    'button',
    { type: 'button', class: 'bag-open', 'data-testid': 'bag-open', 'aria-label': TEXT.bag },
    el('span', { class: 'bag-open-icon', 'aria-hidden': 'true' }, '🎒'),
    el('span', { class: 'bag-open-label' }, TEXT.bag),
  );
  open.hidden = true;

  const close = el(
    'button',
    { type: 'button', class: 'tile-panel-close', 'aria-label': TEXT.close },
    '×',
  );
  const note = el('p', { class: 'bag-note', role: 'status', 'data-testid': 'bag-note' });
  const itemsBox = el('ul', { class: 'bag-items', 'data-testid': 'bag-items' });
  const gathersTitle = el('h3', { class: 'bag-section-title' }, TEXT.gatherTitle);
  const gathersBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-gathers' });
  const recipesBox = el('ul', { class: 'bag-rows', 'data-testid': 'bag-recipes' });
  const sheet = el(
    'section',
    { class: 'bag', 'data-testid': 'bag', role: 'dialog', 'aria-labelledby': 'bag-title' },
    el('div', { class: 'tile-panel-head' }, el('h2', { id: 'bag-title' }, TEXT.title), close),
    note,
    itemsBox,
    gathersTitle,
    gathersBox,
    el('h3', { class: 'bag-section-title' }, TEXT.makeTitle),
    recipesBox,
  );
  sheet.hidden = true;
  options.root.append(open, sheet);

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
      });
    });
    sheet.append(dev);
  }

  open.addEventListener('click', () => {
    sheet.hidden = false;
    renderBag();
    void refresh();
  });
  close.addEventListener('click', () => {
    sheet.hidden = true;
    say('');
    syncTicker();
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

  /**
   * Runs one command for the map on screen, one at a time. A `CONFLICT`
   * (already collected, not ready, something changed) refetches, so the
   * buttons match the server again.
   */
  async function act(run: (mapId: string, at: number) => Promise<void>): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    working = true;
    render();
    try {
      await run(id, at);
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

  const startGather = (tile: PublicTile) =>
    act(async (id, at) => {
      const res = await api.gather(id, { q: tile.q, r: tile.r }, newIdempotencyKey());
      if (!apply(at, { now: res.now })) return;
      state = state && { ...state, gathers: [...state.gathers, res.gather] };
      say(TEXT.started);
    });

  const collectGather = (gatherId: string) =>
    act(async (id, at) => {
      const res = await api.collectGather(id, gatherId, newIdempotencyKey());
      if (!state || !apply(at, { now: res.now, items: res.items })) return;
      state = { ...state, gathers: state.gathers.filter((g) => g.id !== gatherId) };
      say(TEXT.got(describeItems(res.granted)));
    });

  const startCraft = (recipeId: string) =>
    act(async (id, at) => {
      const res = await api.craft(id, recipeId, newIdempotencyKey());
      if (!state || !apply(at, { now: res.now, items: res.items })) return;
      state = { ...state, crafts: [...state.crafts, res.craft] };
      say('');
    });

  const collectCraft = (craftId: string) =>
    act(async (id, at) => {
      const res = await api.collectCraft(id, craftId, newIdempotencyKey());
      if (!state || !apply(at, { now: res.now, items: res.items })) return;
      state = { ...state, crafts: state.crafts.filter((c) => c.id !== craftId) };
      say(TEXT.got(describeItems(res.granted)));
    });

  // ── Drawing ───────────────────────────────────────────────────────────

  const button = (label: string, onTap: () => void, extra: Record<string, string> = {}) => {
    const b = el('button', { type: 'button', class: 'auth-button bag-action', ...extra }, label);
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  function renderBag(): void {
    if (sheet.hidden || !state) return;
    const now = clock.now();

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
        const left = clock.msUntil(g.readyAt);
        const label = `${itemIcon(g.resource)} ${itemName(g.resource)}`;
        return el(
          'li',
          { class: 'bag-row' },
          el('span', { class: 'bag-row-name' }, label),
          left > 0
            ? el('span', { class: 'bag-row-wait' }, formatTimeLeft(left))
            : button(TEXT.collect, () => void collectGather(g.id)),
        );
      }),
    );

    recipesBox.replaceChildren(
      ...bagRecipes(state.items, state.crafts, state.seasons).map(
        ({ recipe, icon, cost, state: s }) => {
          const craft = state?.crafts.find((c) => c.recipeId === recipe.id);
          let action: Node;
          if (craft) {
            const left = Date.parse(craft.readyAt) - now;
            action =
              left > 0
                ? el(
                    'span',
                    { class: 'bag-row-wait' },
                    TEXT.making(recipe.name, formatTimeLeft(left)),
                  )
                : button(TEXT.collect, () => void collectCraft(craft.id));
          } else if (s.kind === 'ready') {
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
      case 'waiting':
        container.replaceChildren(
          line(TEXT.waiting(formatTimeLeft(clock.msUntil(action.gather.readyAt)))),
        );
        break;
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
      case 'busy': {
        const left = clock.msUntil(action.readyAt);
        container.replaceChildren(line(left > 0 ? TEXT.busy(formatTimeLeft(left)) : TEXT.busyDone));
        break;
      }
    }
  }

  function render(): void {
    // The tile panel covers the button's spot and has its own gather buttons.
    open.hidden = mapId === null || panel !== null;
    renderBag();
    renderTile();
    syncTicker();
  }

  /** Ticks once a second only while a countdown is on screen. */
  function syncTicker(): void {
    const counting =
      shownAction?.kind === 'waiting' ||
      shownAction?.kind === 'busy' ||
      (!sheet.hidden && state !== null && (state.gathers.length > 0 || state.crafts.length > 0));
    if (counting && ticker === undefined) {
      ticker = window.setInterval(() => {
        renderBag();
        renderTile();
        syncTicker();
      }, 1000);
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
      render();
    },
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
      };
    },
  };
}
