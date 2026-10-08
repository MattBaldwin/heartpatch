import {
  recipeBookPages,
  type Hex,
  type InventoryResponse,
  type PublicUser,
} from '@heartpatch/shared';
import { createFactoryPanel } from '../factory/factory-panel.js';
import { createFactoryStrip } from '../factory/factory-strip.js';
import { FACTORY_TEXT, recipeIcon } from '../factory/factory-view.js';
import { formatTimeLeft } from '../inventory/game-clock.js';
import { el, messageOf } from '../ui/dom.js';
import {
  bookOrder,
  bookTabs,
  bookSpreads,
  cookingView,
  freshPages,
  pageView,
  searchPages,
  spreadOf,
  type PageView,
} from './book-model.js';
import { recipeBookApi, type RecipeBookApi } from './recipe-book-api.js';
import './recipe-book.css';

// The Keeper's Recipe Book (owner decision 2026-10-05): a real little book
// with a cover, a contents page and one recipe per page (two-page spreads on
// a tablet), turned by a swipe or Next/Back. Each page says what you have of
// each ingredient, where to find it, and has "Make it" (the server crafts:
// CLAUDE.md rule 1) or "Build it" (Home). Pages open the first time the
// account has collected everything they need; a sealed page shows a gentle
// hint, and a page that just opened gets a "New page!" moment. Which pages
// the player has looked at is kept on this device, per account.

export interface RecipeBookOptions {
  root: HTMLElement;
  /** Where the "Recipe book" entry goes (the My Home tray); defaults to `root`. */
  entryRoot?: HTMLElement;
  api?: RecipeBookApi;
  /** The bag's own calls (its crafting path, items, crafts on the go and seasons). */
  inventory: {
    readonly bag: InventoryResponse | null;
    refresh: () => Promise<void>;
    craft: (recipeId: string) => Promise<string | null>;
    /** A Crafting Factory batch (#294); null once started, else a line saying why not. */
    queue: (recipeId: string, count: number) => Promise<string | null>;
    stopBatch: (batchId: string) => Promise<string | null>;
    /** The game clock now, in ms. */
    gameNow: () => number;
    /** Ms until an ISO time on the server's clock. */
    msUntil: (iso: string) => number;
  };
  /** Opens home base, to build a building page there. */
  openHome: () => void;
  /** The player's own tile to find an item on, or null when they have none. */
  spotFor: (resourceId: string) => Hex | null;
  /** Shows that tile on the map (selects it and glides there). */
  showOnMap: (h: Hex) => void;
  /** Where "pages looked at" are kept (null: not kept). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Two-page spreads (a tablet held sideways). */
  twoUp?: () => boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface RecipeBookDebug {
  readonly open: boolean;
  /** Page keys on screen ('cover', 'contents', 'recipe:…', 'building:…', 'end'). */
  readonly showing: readonly string[];
  readonly unlocked: readonly string[];
  /** Pages opened that the player hasn't looked at yet. */
  readonly fresh: readonly string[];
  readonly canMakeOnly: boolean;
  readonly searching: boolean;
  /** The "what's cooking" strip: counting down, or hidden. */
  readonly cooking: 'making' | null;
}

export interface RecipeBook {
  /** The map on screen (null: none): shows the entry. */
  setMap: (mapId: string | null) => void;
  setUser: (user: PublicUser | null) => void;
  /** Asks the server which pages are open (after something new was collected). */
  check: () => Promise<void>;
  open: () => void;
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: RecipeBookDebug | null;
}

// Player-facing text (style guide §2, §6).
export const RECIPE_BOOK_TEXT = {
  entry: 'Recipe book',
  news: 'A new page in your recipe book!',
  cover: 'Keeper’s Recipe Book',
  belongs: (name: string) => `This book belongs to ${name}`,
  openBook: 'Open the book',
  title: (name: string) => `${name}’s Recipe Book`,
  close: 'Close the recipe book',
  canMakeOnly: 'Can make now',
  search: 'Search the recipe book',
  searchLabel: 'A name or ingredient',
  closeSearch: 'Close search',
  noMatch: 'No pages match. Try “pumpkin”!',
  sealedLeft: (n: number) =>
    n === 1 ? '1 sealed page is still a secret!' : `${String(n)} sealed pages are still a secret!`,
  page: (n: number) => `Page ${String(n)}`,
  pages: (a: number, b: number | null) =>
    b === null ? `Page ${String(a)}` : `Pages ${String(a)}–${String(b)}`,
  pageOf: (n: number, of: number) => `Page ${String(n)} of ${String(of)}`,
  back: 'Back',
  next: 'Next',
  prevPage: 'Previous page',
  nextPage: 'Next page',
  contents: 'Contents',
  make: 'Make',
  build: 'Build at home',
  sealedName: 'A sealed page',
  sealedNote: 'Collect everything it needs and this page opens by itself!',
  stillSealed: (n: number) =>
    n === 0
      ? 'Every page is open. Wow!'
      : n === 1
        ? '1 page is still sealed. Keep exploring!'
        : `${String(n)} pages are still sealed. Keep exploring!`,
  onlyCanMake: 'Showing the pages you can make right now.',
  youNeed: 'You need',
  findOnMap: 'Find on map',
  findLabel: (what: string) => `Find ${what} on the map`,
  haveLabel: (have: number, need: number) => `You have ${String(have)}, you need ${String(need)}`,
  makeIt: 'Make it',
  buildIt: 'Build it',
  making: (name: string) => `Making ${name}! Come back when it’s ready.`,
  buildNote: 'You pick the spot at home.',
  newPage: 'New page!',
  foundAll: 'You found everything it needs.',
  turnToIt: 'Turn to it',
  later: 'Later',
  morePages: 'More pages to find',
  morePagesLine: 'New pages appear when you collect new things. Some only bloom in their season!',
  newTag: 'New!',
  cooking: (name: string, left: string) => `Your pot is busy making ${name}… ${left}`,
} as const;

const PAGES = recipeBookPages();
const SEEN_KEY = (accountId: string) => `heartpatch.recipe-book.seen.${accountId}`;

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createRecipeBook(options: RecipeBookOptions): RecipeBook {
  const api = options.api ?? recipeBookApi;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const twoUp =
    options.twoUp ??
    (() => window.matchMedia('(min-width: 900px) and (orientation: landscape)').matches);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let unlocked: string[] = [];
  let seen: Set<string> | null = null;
  let fresh: string[] = [];
  let canMakeOnly = false;
  /** The page the player is on (its spread is what's shown). */
  let at = 'cover';
  let searching = false;
  let query = '';
  /** The "New page!" card: which page, or null. */
  let moment: string | null = null;
  /** The card whose button already took focus. */
  let momentFocused: string | null = null;
  let say = '';
  let busy = false;
  let generation = 0;
  /** The recipe whose page shows the Factory's "How many?" (#294), or null. */
  let queueing: string | null = null;

  // ── Entry in the My Home tray ───────────────────────────────────
  const entryBadge = el('span', {
    class: 'recipe-book-badge',
    'aria-hidden': 'true',
    'data-tray-alert': RECIPE_BOOK_TEXT.news,
  });
  const entry = el(
    'button',
    { type: 'button', class: 'recipe-book-open', 'data-testid': 'recipe-book-open' },
    el('span', { 'aria-hidden': 'true' }, '📖'),
    el('span', {}, RECIPE_BOOK_TEXT.entry),
    entryBadge,
  );
  entry.hidden = true;
  entry.addEventListener('click', () => {
    openBook();
  });
  (options.entryRoot ?? options.root).append(entry);

  // ── The book ──────────────────────────────────────────────────────────
  const closeButton = el(
    'button',
    {
      type: 'button',
      class: 'rbook-btn',
      'aria-label': RECIPE_BOOK_TEXT.close,
      'data-testid': 'recipe-book-close',
    },
    '×',
  );
  closeButton.addEventListener('click', () => {
    closeBook();
  });
  const title = el('h2', { class: 'rbook-title', id: 'rbook-title' });
  const bookmark = el(
    'button',
    {
      type: 'button',
      class: 'rbook-mark',
      'aria-pressed': 'false',
      'data-testid': 'recipe-book-can-make',
    },
    el('span', { 'aria-hidden': 'true' }, '✓'),
    RECIPE_BOOK_TEXT.canMakeOnly,
  );
  bookmark.addEventListener('click', () => {
    canMakeOnly = !canMakeOnly;
    at = 'contents';
    render('none');
  });
  const searchButton = el(
    'button',
    {
      type: 'button',
      class: 'rbook-btn',
      'aria-label': RECIPE_BOOK_TEXT.search,
      'data-testid': 'recipe-book-search',
    },
    '🔍',
  );
  searchButton.addEventListener('click', () => {
    searching = true;
    render('none');
    searchInput.focus();
  });
  const bar = el('div', { class: 'rbook-bar' }, closeButton, title, bookmark, searchButton);

  const tabs = el('div', { class: 'rbook-tabs', role: 'group' });
  const stage = el('div', { class: 'rbook-stage' });
  const prev = el(
    'button',
    {
      type: 'button',
      class: 'rbook-nav-btn',
      'aria-label': RECIPE_BOOK_TEXT.prevPage,
      'data-testid': 'recipe-book-prev',
    },
    `‹ ${RECIPE_BOOK_TEXT.back}`,
  );
  const next = el(
    'button',
    {
      type: 'button',
      class: 'rbook-nav-btn',
      'aria-label': RECIPE_BOOK_TEXT.nextPage,
      'data-testid': 'recipe-book-next',
    },
    `${RECIPE_BOOK_TEXT.next} ›`,
  );
  const pageLabel = el('span', { class: 'rbook-page-label' });
  const sayLine = el('p', { class: 'rbook-say', role: 'status', 'data-testid': 'recipe-book-say' });
  prev.addEventListener('click', () => {
    turn(-1);
  });
  next.addEventListener('click', () => {
    turn(1);
  });
  const nav = el('div', { class: 'rbook-nav' }, prev, pageLabel, next);

  const searchInput = el('input', {
    type: 'search',
    class: 'rbook-search-input',
    placeholder: RECIPE_BOOK_TEXT.searchLabel,
    'aria-label': RECIPE_BOOK_TEXT.search,
    'data-testid': 'recipe-book-search-input',
  });
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderSearch();
  });
  const searchClose = el(
    'button',
    {
      type: 'button',
      class: 'rbook-btn rbook-btn-soft',
      'aria-label': RECIPE_BOOK_TEXT.closeSearch,
    },
    '×',
  );
  searchClose.addEventListener('click', () => {
    searching = false;
    render('none');
  });
  const searchResults = el('div', { class: 'rbook-results', 'data-testid': 'recipe-book-results' });
  const searchSheet = el(
    'div',
    { class: 'rbook-search', role: 'dialog', 'aria-label': RECIPE_BOOK_TEXT.search },
    el(
      'div',
      { class: 'rbook-search-box' },
      el('div', { class: 'rbook-search-head' }, searchInput, searchClose),
      searchResults,
    ),
  );

  const momentBox = el('div', { class: 'rbook-moment-wrap' });

  // What's cooking (the owner's playtest of 2026-10-06): the server makes one
  // thing at a time per patch, so while something cooks the book says what
  // and counts down on the server's clock; when it's done it goes into the
  // bag by itself and the strip goes. Built only when what it shows changes;
  // the tick rewrites its words.
  const cookingBox = el('div', { class: 'rbook-cooking', 'data-testid': 'recipe-book-cooking' });
  cookingBox.hidden = true;
  // The Crafting Factory's batches under it (#294), and its "How many?" on a page.
  const factoryStrip = createFactoryStrip(() => options.inventory.gameNow());
  factoryStrip.element.classList.add('rbook-factory');
  const factoryPanel = createFactoryPanel({
    now: () => options.inventory.gameNow(),
    start: async (recipeId, count) => {
      const failure = await options.inventory.queue(recipeId, count);
      if (failure === null) say = FACTORY_TEXT.started(count, recipeIcon(recipeId));
      return failure;
    },
    stop: (batchId) => options.inventory.stopBatch(batchId),
    isOpen: (key) => unlocked.includes(key),
    onMode: (mode) => {
      if (mode !== 'pick' && queueing !== null) {
        queueing = null;
        render('none');
      }
    },
  });

  const book = el(
    'section',
    {
      class: 'rbook',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'rbook-title',
      'data-testid': 'recipe-book',
    },
    bar,
    cookingBox,
    factoryStrip.element,
    tabs,
    stage,
    sayLine,
    nav,
    searchSheet,
    momentBox,
  );
  book.hidden = true;
  options.root.append(book);

  // Swipe to turn a page (a tap's buttons still work: only a real sideways
  // drag turns; scrolling a long page up and down never does).
  let swipeFrom: { x: number; y: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    swipeFrom = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('pointerup', (e) => {
    if (swipeFrom === null) return;
    const dx = e.clientX - swipeFrom.x;
    const dy = e.clientY - swipeFrom.y;
    swipeFrom = null;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < -50) turn(1);
    else if (dx > 50) turn(-1);
  });
  stage.addEventListener('pointercancel', () => {
    swipeFrom = null;
  });

  // ── State ─────────────────────────────────────────────────────────────

  const views = (): PageView[] => {
    const bag = options.inventory.bag;
    const ctx = {
      unlocked: new Set(unlocked),
      bag: bag?.items ?? {},
      seasons: new Set(bag?.seasons ?? []),
      unseen: new Set(fresh),
      potBusy: (bag?.crafts ?? []).some((c) => options.inventory.msUntil(c.readyAt) > 0),
    };
    return PAGES.map((p) => pageView(p, ctx));
  };

  const saveSeen = () => {
    if (!user || !seen) return;
    try {
      storage?.setItem(SEEN_KEY(user.id), JSON.stringify([...seen]));
    } catch {
      // Private mode: a page may say "New!" once more, which is fine.
    }
  };
  const loadSeen = (accountId: string): Set<string> | null => {
    try {
      const raw = storage?.getItem(SEEN_KEY(accountId)) ?? null;
      if (raw === null) return null;
      const list: unknown = JSON.parse(raw);
      return Array.isArray(list) ? new Set(list.filter((k) => typeof k === 'string')) : null;
    } catch {
      return null;
    }
  };

  /** The player has looked: these pages aren't new any more. */
  const markSeen = (keys: readonly string[]) => {
    if (!seen || keys.length === 0) return;
    for (const k of keys) seen.add(k);
    fresh = fresh.filter((k) => !keys.includes(k));
    saveSeen();
  };

  async function check(): Promise<void> {
    const who = user;
    const ticket = generation;
    if (!who) return;
    try {
      const res = await api.get();
      if (user !== who || ticket !== generation) return;
      unlocked = res.unlocked;
      const result = freshPages(unlocked, seen ?? loadSeen(who.id));
      seen = result.seen;
      fresh = result.fresh;
      saveSeen();
      if (fresh.length > 0 && !book.hidden && moment === null) moment = fresh[0] ?? null;
      render('none');
    } catch {
      // The book still opens with what it knew.
    }
  }

  /** Where focus goes back to when the book shuts (VoiceOver, keyboards). */
  let returnFocus: HTMLElement | null = null;

  function openBook(): void {
    if (!mapId) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    book.hidden = false;
    searching = false;
    say = '';
    at = 'cover';
    moment = fresh[0] ?? null;
    momentFocused = null;
    render('none');
    // The New page! card takes focus when there is one (render focused it).
    if (!moment) closeButton.focus();
    void Promise.all([options.inventory.refresh(), check()]).then(() => {
      render('none');
    });
  }

  function closeBook(): void {
    const wasOpen = !book.hidden;
    book.hidden = true;
    searching = false;
    moment = null;
    render('none');
    if (wasOpen && returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus();
    returnFocus = null;
  }

  function goTo(key: string, dir: 1 | -1 | 0): void {
    at = key;
    say = '';
    render(dir === 0 ? 'none' : dir > 0 ? 'next' : 'prev');
  }

  function turn(step: 1 | -1): void {
    const spreads = bookSpreads(bookOrder(views(), canMakeOnly), twoUp());
    const i = spreadOf(spreads, at);
    const j = Math.max(0, Math.min(spreads.length - 1, i + step));
    const key = spreads[j]?.[0];
    if (j !== i && key) goTo(key, step);
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  const ingredientLine = (page: PageView, i: PageView['ingredients'][number]) => {
    const spot = options.spotFor(i.id);
    const find = spot
      ? [
          (() => {
            const b = el(
              'button',
              {
                type: 'button',
                class: 'rbook-find',
                'aria-label': RECIPE_BOOK_TEXT.findLabel(i.name),
                'data-testid': 'recipe-book-find',
                'data-resource': i.id,
              },
              '📍 ',
              RECIPE_BOOK_TEXT.findOnMap,
            );
            b.addEventListener('click', () => {
              closeBook();
              options.showOnMap(spot);
            });
            return b;
          })(),
        ]
      : [];
    return el(
      'li',
      { class: 'rbook-ing', 'data-ingredient': i.id, 'data-page': page.key },
      el(
        'div',
        { class: 'rbook-ing-row' },
        el('span', { class: 'rbook-ing-icon', 'aria-hidden': 'true' }, i.icon),
        el('b', {}, i.name),
        el(
          'span',
          {
            class: i.ok ? 'rbook-qty rbook-qty-ok' : 'rbook-qty rbook-qty-short',
            'aria-label': RECIPE_BOOK_TEXT.haveLabel(i.have, i.need),
            'data-testid': 'recipe-book-qty',
          },
          `${String(i.have)}/${String(i.need)}`,
        ),
      ),
      el(
        'div',
        { class: 'rbook-where' },
        el('span', {}, i.where, ...(i.season ? [' ', el('em', {}, i.season)] : [])),
        ...find,
      ),
    );
  };

  /** "🏭 Queue in Factory" beside Make it, once the Factory is built (#294). */
  const queueButton = (page: PageView): HTMLElement[] => {
    const factory = options.inventory.bag?.factory;
    if (!factory || page.kind !== 'recipe' || page.sealed) return [];
    const button = el(
      'button',
      {
        type: 'button',
        class: page.queueable
          ? 'rbook-stamp rbook-queue'
          : 'rbook-stamp rbook-stamp-off rbook-queue',
        'data-testid': 'recipe-book-queue',
        'data-page': page.key,
      },
      FACTORY_TEXT.queueIn,
    );
    button.disabled = !page.queueable || busy;
    button.addEventListener('click', () => {
      queueing = page.id;
      const bag = options.inventory.bag;
      if (bag?.factory) {
        factoryPanel.update({ view: bag.factory, items: bag.items, seasons: bag.seasons });
      }
      factoryPanel.pick(page.id, true);
      render('none');
    });
    return [button];
  };

  const cta = (page: PageView): HTMLElement[] => {
    const make = page.kind === 'recipe';
    const label = make ? RECIPE_BOOK_TEXT.makeIt : RECIPE_BOOK_TEXT.buildIt;
    const button = el(
      'button',
      {
        type: 'button',
        class: page.canMake ? 'rbook-stamp' : 'rbook-stamp rbook-stamp-off',
        'data-testid': 'recipe-book-make',
        'data-page': page.key,
      },
      label,
    );
    button.disabled = !page.canMake || busy;
    button.addEventListener('click', () => {
      if (!make) {
        closeBook();
        options.openHome();
        return;
      }
      busy = true;
      render('none');
      const ticket = generation;
      void options.inventory
        .craft(page.id)
        .then((failure) => {
          if (ticket !== generation) return;
          say = failure ?? RECIPE_BOOK_TEXT.making(page.name);
        })
        .catch((err: unknown) => {
          if (ticket === generation) say = messageOf(err);
        })
        .finally(() => {
          busy = false;
          if (ticket === generation) render('none');
        });
    });
    const note = page.canMake
      ? make
        ? (page.meta.split(' · ')[1] ?? '')
        : RECIPE_BOOK_TEXT.buildNote
      : (page.note ?? '');
    const queue = queueButton(page);
    if (queue.length === 0) return [button, el('p', { class: 'rbook-note' }, note)];
    return [
      el('div', { class: 'rbook-ctas' }, button, ...queue),
      el('p', { class: 'rbook-note' }, page.queueable ? FACTORY_TEXT.bothHint : note),
    ];
  };

  const head = (page: PageView) =>
    el(
      'div',
      { class: 'rbook-top' },
      el(
        'span',
        { class: 'rbook-section' },
        page.section === 'make' ? RECIPE_BOOK_TEXT.make : RECIPE_BOOK_TEXT.build,
      ),
      ...(page.season ? [el('span', { class: 'rbook-ribbon' }, page.season)] : []),
    );

  const recipePage = (page: PageView) => [
    head(page),
    el(
      'div',
      { class: 'rbook-picture', 'aria-hidden': 'true' },
      page.icon,
      ...(page.isNew ? [el('span', { class: 'rbook-sticker' }, RECIPE_BOOK_TEXT.newTag)] : []),
    ),
    el('h3', { class: 'rbook-name' }, page.name),
    ...(page.effect
      ? [
          el('p', { class: 'rbook-purpose', 'data-testid': 'rbook-purpose' }, page.effect.purpose),
          el(
            'div',
            { class: 'rbook-chips', 'data-testid': 'rbook-chips' },
            ...page.effect.chips.map((c) =>
              el(
                'span',
                { class: c.battle ? 'rbook-chip rbook-chip-battle' : 'rbook-chip' },
                c.text,
              ),
            ),
          ),
        ]
      : []),
    ...(page.flavour ? [el('p', { class: 'rbook-flavour' }, page.flavour)] : []),
    el('p', { class: 'rbook-meta' }, page.meta),
    ...(queueing === page.id && options.inventory.bag?.factory
      ? [el('div', { class: 'rbook-foot rbook-factory-pick' }, factoryPanel.element)]
      : [
          el('h4', { class: 'rbook-need' }, RECIPE_BOOK_TEXT.youNeed),
          el(
            'ul',
            { class: 'rbook-ings' },
            ...page.ingredients.map((i) => ingredientLine(page, i)),
          ),
          el('div', { class: 'rbook-foot' }, ...cta(page)),
        ]),
  ];

  const sealedPage = (page: PageView) => [
    head(page),
    el(
      'div',
      { class: 'rbook-seal-wrap', 'aria-hidden': 'true' },
      el('span', { class: 'rbook-twine' }),
      el('span', { class: 'rbook-seal' }, '💗'),
    ),
    el('h3', { class: 'rbook-name' }, RECIPE_BOOK_TEXT.sealedName),
    el('p', { class: 'rbook-flavour' }, page.hint),
    el(
      'div',
      { class: 'rbook-foot' },
      el('p', { class: 'rbook-note' }, RECIPE_BOOK_TEXT.sealedNote),
    ),
  ];

  const contentsPage = (all: readonly PageView[], order: readonly string[]) => {
    const rows: HTMLElement[] = [];
    for (const section of ['make', 'build'] as const) {
      const pages = all.filter((p) => p.section === section && order.includes(p.key));
      if (pages.length === 0) continue;
      rows.push(
        el(
          'h4',
          { class: 'rbook-need' },
          section === 'make' ? RECIPE_BOOK_TEXT.make : RECIPE_BOOK_TEXT.build,
        ),
      );
      for (const p of pages) {
        const row = el(
          'button',
          {
            type: 'button',
            class: p.sealed ? 'rbook-toc rbook-toc-sealed' : 'rbook-toc',
            'data-testid': 'recipe-book-toc',
            'data-page': p.key,
          },
          el('span', {}, p.sealed ? RECIPE_BOOK_TEXT.sealedName : p.name),
          ...(p.isNew ? [el('span', { class: 'rbook-new' }, RECIPE_BOOK_TEXT.newTag)] : []),
          ...(p.canMake
            ? [el('span', { class: 'rbook-can', 'aria-label': RECIPE_BOOK_TEXT.canMakeOnly }, '✓')]
            : []),
          el('span', { class: 'rbook-dots', 'aria-hidden': 'true' }),
          el('span', { class: 'rbook-toc-page' }, String(order.indexOf(p.key))),
        );
        row.addEventListener('click', () => {
          goTo(p.key, 1);
        });
        rows.push(row);
      }
    }
    const sealedCount = all.filter((p) => p.sealed).length;
    return [
      el('h3', { class: 'rbook-name' }, RECIPE_BOOK_TEXT.contents),
      ...rows,
      el(
        'p',
        { class: 'rbook-toc-note' },
        canMakeOnly ? RECIPE_BOOK_TEXT.onlyCanMake : RECIPE_BOOK_TEXT.stillSealed(sealedCount),
      ),
    ];
  };

  const endPage = () => [
    el(
      'div',
      { class: 'rbook-end' },
      el('span', { class: 'rbook-picture', 'aria-hidden': 'true' }, '✨'),
      el('h3', { class: 'rbook-name' }, RECIPE_BOOK_TEXT.morePages),
      el('p', { class: 'rbook-flavour' }, RECIPE_BOOK_TEXT.morePagesLine),
    ),
  ];

  const cover = () => {
    const open = el(
      'button',
      { type: 'button', class: 'rbook-open', 'data-testid': 'recipe-book-cover-open' },
      RECIPE_BOOK_TEXT.openBook,
    );
    open.addEventListener('click', () => {
      goTo('contents', 1);
    });
    return el(
      'div',
      { class: 'rbook-cover', 'data-page': 'cover' },
      el('span', { class: 'rbook-cover-seed', 'aria-hidden': 'true' }, '💗'),
      el('h3', { class: 'rbook-cover-title' }, RECIPE_BOOK_TEXT.cover),
      el('p', { class: 'rbook-cover-sub' }, RECIPE_BOOK_TEXT.belongs(user?.username ?? '')),
      open,
    );
  };

  /** The strip's countdown words: one Text node rewritten in place (`data`), never replaced (DECISIONS, Fix PR #173). */
  let cookingCountdown: { text: Text; readyAt: string; name: string } | null = null;
  /** The craft the strip is built for, so other redraws leave it alone. */
  let cookingShown: string | null = null;
  let cookingTicker: number | undefined;

  function renderCooking(): void {
    const bag = options.inventory.bag;
    const view =
      book.hidden || !bag ? null : cookingView(bag.crafts, (iso) => options.inventory.msUntil(iso));
    const key = view?.craft.id ?? null;
    if (key !== cookingShown) {
      cookingShown = key;
      cookingCountdown = null;
      cookingBox.hidden = view === null;
      if (!view) {
        cookingBox.replaceChildren();
      } else {
        const text = document.createTextNode(
          RECIPE_BOOK_TEXT.cooking(
            view.name,
            formatTimeLeft(options.inventory.msUntil(view.craft.readyAt)),
          ),
        );
        cookingCountdown = { text, readyAt: view.craft.readyAt, name: view.name };
        cookingBox.replaceChildren(
          el('span', { class: 'rbook-cooking-icon', 'aria-hidden': 'true' }, view.icon),
          el('span', { class: 'rbook-cooking-text' }, text),
        );
      }
    }
    // Tick once a second only while the strip counts down.
    if (cookingCountdown && cookingTicker === undefined) {
      cookingTicker = window.setInterval(tickCooking, 1000);
    } else if (!cookingCountdown && cookingTicker !== undefined) {
      window.clearInterval(cookingTicker);
      cookingTicker = undefined;
    }
  }

  /**
   * One tick: rewrite the words; once it's done, redraw: the strip goes and
   * Make it wakes up (the bag's settle puts it in the bag, with its pop-up).
   */
  function tickCooking(): void {
    if (!cookingCountdown) return;
    const left = options.inventory.msUntil(cookingCountdown.readyAt);
    if (left <= 0) render('none');
    else
      cookingCountdown.text.data = RECIPE_BOOK_TEXT.cooking(
        cookingCountdown.name,
        formatTimeLeft(left),
      );
  }

  function render(motion: 'none' | 'next' | 'prev'): void {
    entry.hidden = mapId === null;
    renderCooking();
    const bag = options.inventory.bag;
    factoryStrip.update(book.hidden ? null : (bag?.factory ?? null));
    if (bag?.factory && queueing !== null) {
      factoryPanel.update({ view: bag.factory, items: bag.items, seasons: bag.seasons });
    }
    entryBadge.textContent = fresh.length > 0 ? String(fresh.length) : '';
    if (book.hidden) return;

    const all = views();
    const order = bookOrder(all, canMakeOnly);
    const two = twoUp();
    const spreads = bookSpreads(order, two);
    const index = spreadOf(spreads, at);
    const showing = spreads[index] ?? ['cover'];
    at = showing[0] ?? 'cover';
    book.classList.toggle('rbook-two-up', two);
    const onCover = at === 'cover';
    book.classList.toggle('rbook-on-cover', onCover);
    title.textContent = onCover
      ? RECIPE_BOOK_TEXT.entry
      : RECIPE_BOOK_TEXT.title(user?.username ?? '');
    bookmark.hidden = onCover;
    searchButton.hidden = onCover;
    bookmark.classList.toggle('rbook-mark-on', canMakeOnly);
    bookmark.setAttribute('aria-pressed', canMakeOnly ? 'true' : 'false');

    // Ribbon tabs: jump to the first page of each part.
    const byKey = new Map(all.map((p) => [p.key, p]));
    const firstOf = (pred: (p: PageView) => boolean) =>
      order.find((k) => {
        const p = byKey.get(k);
        return p !== undefined && pred(p);
      });
    tabs.hidden = onCover;
    tabs.replaceChildren(
      ...bookTabs(all).flatMap(({ label, matches: pred, color }) => {
        const target = firstOf(pred);
        if (!target) return [];
        const current = showing.some((k) => {
          const p = byKey.get(k);
          return p !== undefined && pred(p);
        });
        const tab = el(
          'button',
          {
            type: 'button',
            class: `rbook-tab${current ? ' rbook-tab-current' : ''}`,
            style: `background: ${color}`,
            'aria-current': current ? 'page' : 'false',
          },
          label,
        );
        tab.addEventListener('click', () => {
          goTo(target, 1);
        });
        return [tab];
      }),
    );

    // The pages on screen. A fresh spread element each turn, so its turn
    // animation plays (CSS turns it, or crossfades it with reduced motion).
    const spread = el('div', {
      class: `rbook-spread${motion === 'none' ? '' : ` rbook-turn-${motion}`}`,
      'data-testid': 'recipe-book-spread',
    });
    // Turned: a still page keeps no animation (and no 3D layer).
    spread.addEventListener('animationend', (e) => {
      if (e.target === spread) spread.classList.remove('rbook-turn-next', 'rbook-turn-prev');
    });
    if (onCover) {
      spread.append(cover());
    } else {
      showing.forEach((key, i) => {
        const side = two ? (i === 0 ? 'left' : 'right') : 'single';
        const page = byKey.get(key);
        let body: HTMLElement[];
        if (key === 'contents') body = contentsPage(all, order);
        else if (key === 'end') body = endPage();
        else if (page) body = page.sealed ? sealedPage(page) : recipePage(page);
        else body = [];
        const n = order.indexOf(key);
        spread.append(
          el(
            'article',
            {
              class: `rbook-page rbook-page-${side}${page?.sealed ? ' rbook-page-sealed' : ''}`,
              'data-page': key,
              'aria-label': page
                ? page.sealed
                  ? RECIPE_BOOK_TEXT.sealedName
                  : page.name
                : key === 'contents'
                  ? RECIPE_BOOK_TEXT.contents
                  : RECIPE_BOOK_TEXT.morePages,
            },
            ...body,
            el('span', { class: 'rbook-page-number' }, String(n)),
          ),
        );
      });
      // Looking at a new page is what makes it not new.
      markSeen(showing.filter((k) => fresh.includes(k)));
    }
    stage.replaceChildren(spread);

    nav.hidden = onCover;
    const nums = showing.map((k) => order.indexOf(k));
    pageLabel.textContent = two
      ? RECIPE_BOOK_TEXT.pages(nums[0] ?? 0, nums[1] ?? null)
      : RECIPE_BOOK_TEXT.pageOf(nums[0] ?? 0, order.length - 1);
    prev.disabled = index <= 0;
    next.disabled = index >= spreads.length - 1;
    sayLine.textContent = say;

    searchSheet.hidden = !searching;
    if (searching) renderSearch();

    // A re-render (a refresh landing) rebuilds the card: its focus comes back with it.
    const cardHadFocus = momentBox.contains(document.activeElement);
    momentBox.replaceChildren();
    const momentPage = moment ? byKey.get(moment) : undefined;
    if (momentPage && !searching) {
      const turnTo = el(
        'button',
        { type: 'button', class: 'rbook-stamp', 'data-testid': 'recipe-book-new-turn' },
        RECIPE_BOOK_TEXT.turnToIt,
      );
      const later = el('button', { type: 'button', class: 'rbook-later' }, RECIPE_BOOK_TEXT.later);
      turnTo.addEventListener('click', () => {
        moment = null;
        goTo(momentPage.key, 1);
      });
      later.addEventListener('click', () => {
        moment = null;
        markSeen(fresh);
        render('none');
      });
      momentBox.append(
        el(
          'div',
          {
            class: 'rbook-moment',
            role: 'alertdialog',
            'aria-label': RECIPE_BOOK_TEXT.newPage,
            'data-testid': 'recipe-book-new-page',
          },
          el('span', { class: 'rbook-flutter', 'aria-hidden': 'true' }, '📖'),
          el('p', { class: 'rbook-moment-title' }, RECIPE_BOOK_TEXT.newPage),
          el('p', { class: 'rbook-moment-name' }, momentPage.name),
          el('p', { class: 'rbook-moment-line' }, RECIPE_BOOK_TEXT.foundAll),
          turnTo,
          later,
        ),
      );
      // A new card: its button takes focus (once), so VoiceOver reads it out.
      if (cardHadFocus || momentFocused !== momentPage.key) {
        momentFocused = momentPage.key;
        turnTo.focus();
      }
    }
    entryBadge.textContent = fresh.length > 0 ? String(fresh.length) : '';
  }

  function renderSearch(): void {
    const all = views();
    const hits = searchPages(all, query);
    const order = bookOrder(all, false);
    const sealedCount = all.filter((p) => p.sealed).length;
    searchResults.replaceChildren(
      ...hits.map((p) => {
        const row = el(
          'button',
          { type: 'button', class: 'rbook-result', 'data-page': p.key },
          el('span', { class: 'rbook-ing-icon', 'aria-hidden': 'true' }, p.icon),
          el('span', { class: 'rbook-result-name' }, p.name),
          el('span', { class: 'rbook-toc-page' }, RECIPE_BOOK_TEXT.page(order.indexOf(p.key))),
        );
        row.addEventListener('click', () => {
          searching = false;
          canMakeOnly = false;
          goTo(p.key, 1);
        });
        return row;
      }),
      ...(hits.length === 0
        ? [el('p', { class: 'rbook-toc-note' }, RECIPE_BOOK_TEXT.noMatch)]
        : []),
      ...(sealedCount > 0
        ? [el('p', { class: 'rbook-toc-note' }, RECIPE_BOOK_TEXT.sealedLeft(sealedCount))]
        : []),
    );
  }

  document.addEventListener('keydown', (e) => {
    if (book.hidden) return;
    if (e.key === 'Escape') {
      if (searching) {
        searching = false;
        render('none');
      } else closeBook();
    } else if (!searching && e.key === 'ArrowRight') turn(1);
    else if (!searching && e.key === 'ArrowLeft') turn(-1);
  });

  return {
    setMap: (next) => {
      if (next === mapId) {
        // Back on the same map (after a battle, a rescue): something new may
        // have landed in the bag meanwhile.
        if (next) void check();
        return;
      }
      generation += 1;
      mapId = next;
      if (next === null) closeBook();
      render('none');
      if (next) void check();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      generation += 1;
      user = next;
      unlocked = [];
      seen = null;
      fresh = [];
      mapId = null;
      closeBook();
    },
    check,
    open: openBook,
    close: closeBook,
    get isOpen() {
      return !book.hidden;
    },
    get debug() {
      if (!user) return null;
      const order = bookOrder(views(), canMakeOnly);
      const spreads = bookSpreads(order, twoUp());
      return {
        open: !book.hidden,
        showing: book.hidden ? [] : (spreads[spreadOf(spreads, at)] ?? []),
        unlocked: [...unlocked],
        fresh: [...fresh],
        canMakeOnly,
        searching,
        cooking: cookingShown === null ? null : ('making' as const),
      };
    },
  };
}
