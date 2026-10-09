import type { LorebookResponse, LorePage, PublicUser } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { createLoreBagEntry, type LoreBagEntry } from './bag-entry.js';
import { loreApi, type LoreApi } from './lore-api.js';
import { bookCounts, LORE_TEXT, newPages } from './lore-view.js';
import { createLorebookScreen, type LorebookScreen } from './lorebook-screen.js';
import './lore.css';

// The Lorebook (design doc §16, #307): a little card when a page is found
// (with "Open Lorebook"), and the book itself, opened from the card, the Bag's
// tile and Settings. The words come from the server only once a page is
// found, so they're never in this bundle. Unread pages are kept on the server
// (`readAt`), so the Bag's sparkle is the same on every device.

export interface LorebookOptions {
  root: HTMLElement;
  api?: Pick<LoreApi, 'book' | 'markRead'>;
  setTimer?: (task: () => void, ms: number) => unknown;
  /**
   * True while a card would be in the way (a battle, another card): a found
   * page waits and tries again, so cards come one at a time (#129).
   */
  busy?: () => boolean;
  /** The card or the book opened or closed (so the next sheet in line can take its turn). */
  onChange?: () => void;
  /** The book as a tablet spread; tests pass their own. */
  twoUp?: () => boolean;
  /** The Bag's tile and sparkle (made before the Bag, which mounts them; else its own). */
  bagEntry?: LoreBagEntry;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface LorebookDebug {
  /** The page on the card, if it's open. */
  readonly showing: string | null;
  /** The book is open, and the page on screen (null: the contents). */
  readonly bookOpen: boolean;
  readonly bookAt: string | null;
  /** Found pages, all pages, and found pages not yet read in the book. */
  readonly found: number;
  readonly total: number;
  readonly unread: number;
}

export interface Lorebook {
  setUser: (user: PublicUser | null) => void;
  /** Looks for newly found pages now and once more a little later (the finder runs after the play). */
  check: () => void;
  /**
   * Opens the book at a page (its id), or at the contents (null). A page found
   * a moment ago is waited for (the finder runs just after the play), so a
   * find card can call it at once.
   */
  openAt: (pageId: string | null) => void;
  /** Fetches the book again for the Bag's counts and sparkle (no card). */
  refresh: () => void;
  /** The Settings rows. */
  settings: () => Node[];
  /** The book is open (other cards wait for it). */
  readonly isOpen: boolean;
  readonly debug: LorebookDebug;
}

/** The finder (a server event consumer) can lag the step that found a page. */
const RECHECK_MS = 5_000; // TUNE: guess
/** How often a page that found the screen busy tries again. */
const BUSY_RETRY_MS = 3_000; // TUNE: guess
/** "Open Lorebook" on a page the finder hasn't recorded yet: look again this soon, this often. */
const OPEN_RETRY_MS = 1_200; // TUNE: guess
const OPEN_RETRIES = 4; // TUNE: guess
const SHOWN_KEY = 'heartpatch.lore.shown';

/** Page ids this device has shown, per player (a per-device convenience). */
function readShown(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${SHOWN_KEY}.${userId}`);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeShown(userId: string, ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(`${SHOWN_KEY}.${userId}`, JSON.stringify([...ids]));
  } catch {
    // Private mode or blocked storage: the card may show again. Harmless.
  }
}

export function createLorebook(options: LorebookOptions): Lorebook {
  const api = options.api ?? loreApi;
  const setTimer = options.setTimer ?? ((task, ms) => setTimeout(task, ms));
  const busy = options.busy ?? (() => false);
  let user: PublicUser | null = null;
  /** The book as last heard from the server, or null. */
  let book: LorebookResponse | null = null;
  /** Pages waiting to be shown, and the one showing. */
  let queue: LorePage[] = [];
  let showing: LorePage | null = null;
  /** A page found the screen busy and waits to try again (one wait at a time). */
  let retrying = false;
  /** Pages being marked read (so a re-draw doesn't ask twice). */
  const reading = new Set<string>();

  const remember = (ids: readonly string[]) => {
    if (!user || ids.length === 0) return;
    const shown = readShown(user.id);
    for (const id of ids) shown.add(id);
    writeShown(user.id, shown);
  };

  const bag =
    options.bagEntry ??
    createLoreBagEntry(() => {
      open(null);
    });

  /** Keeps the book and everything that shows its counts. */
  const setBook = (next: LorebookResponse | null) => {
    book = next;
    bag.update(next ? bookCounts(next) : null);
    if (next) screen.update(next);
  };

  const heading = el('p', { class: 'lore-kicker' });
  const title = el('h2', { class: 'lore-title', 'data-testid': 'lore-title' });
  const text = el('p', { class: 'lore-text', 'data-testid': 'lore-text' });
  const openButton = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'lore-open-book' },
    LORE_TEXT.openBook,
  );
  const button = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'lore-close' },
    LORE_TEXT.close,
  );
  const card = el(
    'section',
    {
      class: 'lore-card',
      role: 'dialog',
      'aria-label': LORE_TEXT.title,
      'data-testid': 'lore-card',
    },
    heading,
    title,
    text,
    el('div', { class: 'lore-buttons' }, openButton, button),
  );
  card.hidden = true;
  // The card goes in before the book, so the book sits over it.
  options.root.append(card);

  const screen: LorebookScreen = createLorebookScreen({
    root: options.root,
    ...(options.twoUp ? { twoUp: options.twoUp } : {}),
    onRead: (id) => {
      const who = user;
      if (!who || reading.has(id)) return;
      reading.add(id);
      // Seen in the book: no card for it on this device either.
      remember([id]);
      // The sparkle goes at once; the server keeps it.
      if (book) {
        const now = new Date().toISOString();
        book = {
          ...book,
          slots: book.slots.map((s) => (s.id === id && s.found ? { ...s, readAt: now } : s)),
        };
        bag.update(bookCounts(book));
      }
      api.markRead([id]).then(
        (next) => {
          reading.delete(id);
          if (user?.id === who.id) setBook(next);
        },
        () => {
          // Offline: it's still new on the server, so the sparkle comes back next look.
          reading.delete(id);
        },
      );
    },
    onClose: () => {
      options.onChange?.();
      // A card that waited for the book can show now.
      if (!showing && queue.length > 0) showNext();
    },
  });

  /** Shows the next page waiting, unless something else is in the way. */
  const showNext = () => {
    const next = queue[0];
    if (next && (busy() || screen.isOpen)) {
      if (!retrying) {
        retrying = true;
        setTimer(() => {
          retrying = false;
          if (!showing) showNext();
        }, BUSY_RETRY_MS);
      }
      showing = null;
      card.hidden = true;
      options.onChange?.();
      return;
    }
    showing = queue.shift() ?? null;
    card.hidden = showing === null;
    if (showing) {
      // Remembered once it's really on screen, so a page held back and
      // then reloaded away still turns up.
      remember([showing.id]);
    }
    options.onChange?.();
    if (!showing) return;
    title.textContent = showing.title;
    text.textContent = showing.text;
    button.textContent = queue.length > 0 ? LORE_TEXT.next : LORE_TEXT.close;
  };
  button.addEventListener('click', showNext);
  openButton.addEventListener('click', () => {
    const page = showing?.id ?? null;
    // Every page waiting is in the book too: the card steps aside for it.
    remember(queue.map((p) => p.id));
    queue = [];
    showing = null;
    card.hidden = true;
    open(page);
  });

  const show = (pages: LorePage[], kicker: string) => {
    if (pages.length === 0) return;
    heading.textContent = kicker;
    const waiting = new Set([...queue, ...(showing ? [showing] : [])].map((p) => p.id));
    queue.push(...pages.filter((p) => !waiting.has(p.id)));
    if (!showing) showNext();
  };

  const look = async () => {
    const who = user;
    if (!who) return;
    try {
      const next = await api.book();
      if (user?.id !== who.id) return;
      setBook(next);
      const found = newPages(next.pages, readShown(who.id));
      if (found.length === 0) return;
      show(found, LORE_TEXT.found);
    } catch {
      // Offline: the next check finds it.
    }
  };

  const refreshBook = async () => {
    const who = user;
    if (!who) return;
    try {
      const next = await api.book();
      if (user?.id === who.id) setBook(next);
    } catch {
      // Offline: the next look finds it.
    }
  };

  /** Opens the book at `pageId` (null: the contents) with the freshest words. */
  function open(pageId: string | null, tries = 0): void {
    const who = user;
    if (!who) return;
    api.book().then(
      (next) => {
        if (user?.id !== who.id) return;
        setBook(next);
        // A page still to find has no id of its own in the book, so a page
        // found a moment ago that isn't there yet waits for the finder.
        const slot = pageId === null ? null : (next.slots.find((s) => s.id === pageId) ?? null);
        if (pageId !== null && !slot && tries < OPEN_RETRIES) {
          setTimer(() => {
            open(pageId, tries + 1);
          }, OPEN_RETRY_MS);
          return;
        }
        if (screen.isOpen && tries > 0) screen.update(next);
        else screen.open(next, slot ? slot.id : null);
        options.onChange?.();
      },
      () => {
        // Offline: open with what we knew, if anything.
        if (book && !screen.isOpen) {
          screen.open(book, pageId);
          options.onChange?.();
        }
      },
    );
  }

  return {
    setUser: (next) => {
      user = next;
      queue = [];
      showing = null;
      card.hidden = true;
      screen.close();
      setBook(null);
      options.onChange?.();
      // The Bag's sparkle, without a card (cards wait for a map: `check`).
      if (next) void refreshBook();
    },
    check: () => {
      void look();
      setTimer(() => void look(), RECHECK_MS);
    },
    openAt: (pageId) => {
      open(pageId);
    },
    refresh: () => {
      void refreshBook();
    },
    settings: () => {
      const entry = el(
        'button',
        { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'lore-open' },
        LORE_TEXT.open,
      );
      entry.addEventListener('click', () => {
        open(null);
      });
      return [entry];
    },
    get isOpen() {
      return screen.isOpen;
    },
    get debug() {
      const counts = book ? bookCounts(book) : { found: 0, total: 0, unread: 0 };
      return {
        showing: showing?.id ?? null,
        bookOpen: screen.isOpen,
        bookAt: screen.at,
        ...counts,
      };
    },
  };
}
