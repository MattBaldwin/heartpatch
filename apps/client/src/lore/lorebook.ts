import type { LorePage, PublicUser } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { loreApi, type LoreApi } from './lore-api.js';
import { LORE_TEXT, newPages } from './lore-view.js';
import './lore.css';

// The Lorebook (design doc §16): a little card when a page is found, and
// every found page from Settings. The words come from the server only once a
// page is found, so they're never in this bundle.

export interface LorebookOptions {
  root: HTMLElement;
  api?: Pick<LoreApi, 'pages'>;
  setTimer?: (task: () => void, ms: number) => unknown;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface LorebookDebug {
  /** The page on the card, if it's open. */
  readonly showing: string | null;
}

export interface Lorebook {
  setUser: (user: PublicUser | null) => void;
  /** Looks for newly found pages now and once more a little later (the finder runs after the play). */
  check: () => void;
  /** The Settings rows. */
  settings: () => Node[];
  readonly debug: LorebookDebug;
}

/** The finder (a server event consumer) can lag the step that found a page. */
const RECHECK_MS = 5_000; // TUNE: guess
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
  let user: PublicUser | null = null;
  /** Pages waiting to be shown, and the one showing. */
  let queue: LorePage[] = [];
  let showing: LorePage | null = null;

  const heading = el('p', { class: 'lore-kicker' });
  const title = el('h2', { class: 'lore-title', 'data-testid': 'lore-title' });
  const text = el('p', { class: 'lore-text', 'data-testid': 'lore-text' });
  const button = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'lore-close' },
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
    button,
  );
  card.hidden = true;
  options.root.append(card);

  const showNext = () => {
    showing = queue.shift() ?? null;
    card.hidden = showing === null;
    if (!showing) return;
    title.textContent = showing.title;
    text.textContent = showing.text;
    button.textContent = queue.length > 0 ? LORE_TEXT.next : LORE_TEXT.close;
  };
  button.addEventListener('click', showNext);

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
      const pages = await api.pages();
      if (user?.id !== who.id) return;
      const shown = readShown(who.id);
      const found = newPages(pages, shown);
      if (found.length === 0) return;
      for (const page of found) shown.add(page.id);
      writeShown(who.id, shown);
      show(found, LORE_TEXT.found);
    } catch {
      // Offline: the next check finds it.
    }
  };

  return {
    setUser: (next) => {
      user = next;
      queue = [];
      showing = null;
      card.hidden = true;
    },
    check: () => {
      void look();
      setTimer(() => void look(), RECHECK_MS);
    },
    settings: () => {
      const open = el(
        'button',
        { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'lore-open' },
        LORE_TEXT.open,
      );
      open.addEventListener('click', () => {
        void api.pages().then(
          (pages) => {
            if (pages.length > 0) show(pages, LORE_TEXT.title);
            else
              show(
                [{ id: 'none', title: LORE_TEXT.title, text: LORE_TEXT.empty, foundAt: '' }],
                '',
              );
          },
          () => undefined,
        );
      });
      return [open];
    },
    get debug() {
      return { showing: showing?.id ?? null };
    },
  };
}
