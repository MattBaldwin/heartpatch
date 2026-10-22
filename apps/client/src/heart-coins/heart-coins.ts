import type { HeartCoins } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { heartCoinsApi, type HeartCoinsApi } from './heart-coins-api.js';
import { HEART_COINS_TEXT, type HeartCoinsPage } from './heart-coins-model.js';
import { createHeartCoinsSheet } from './heart-coins-sheet.js';
import { createHeartPill } from './heart-pill.js';
import '../ui/coins/coins.css';
import './heart-coins.css';

// Heart Coins on screen (#601): one 💛 pill on the map's patch-name card,
// one on Home's peek bar, a "💛 42" line on each patch-list card, and the
// sheet a pill opens. Each patch has its own balance, read fresh from
// `GET /maps/:mapId/heart-coins` whenever the map or home comes up, a care
// sheet closes, the app comes back, or the sheet opens. None on the Tutorial
// Glade (main passes null there): it pays none.

export interface HeartCoinsScreenOptions {
  root: HTMLElement;
  /** The game clock in ms (the bag's `gameNow`). */
  now: () => number;
  api?: HeartCoinsApi;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface HeartCoinsDebug {
  readonly mapId: string | null;
  readonly balance: number | null;
  readonly open: boolean;
  readonly page: HeartCoinsPage | null;
}

export interface HeartCoinsScreen {
  /** For the map's patch-name card. */
  readonly mapPill: HTMLElement;
  /** For Home's peek bar. */
  readonly homePill: HTMLElement;
  /** The patch on screen (the map or home), or null (none, or the Glade): reads its balance. */
  setMap: (mapId: string | null) => void;
  /** Reads the balance of the patch on screen again (a failed read keeps the last one). */
  refresh: () => Promise<void>;
  /** A patch-list card's "💛 42", filled in once its balance arrives. */
  lobbyLine: (mapId: string) => HTMLElement;
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: HeartCoinsDebug;
}

export function createHeartCoinsScreen(options: HeartCoinsScreenOptions): HeartCoinsScreen {
  const api = options.api ?? heartCoinsApi;
  const sheet = createHeartCoinsSheet({ root: options.root, now: options.now });
  let mapId: string | null = null;
  let balance: number | null = null;
  /** Bumped on every read and map change, so a late reply for an old one is dropped. */
  let ticket = 0;
  /** The last balance seen on each patch, so a redrawn patch list doesn't flicker. */
  const known = new Map<string, number>();

  const openSheet = (): void => {
    if (mapId === null) return;
    sheet.open();
    void read();
  };
  const mapPill = createHeartPill('map', openSheet);
  const homePill = createHeartPill('home', openSheet);
  const pills = [mapPill, homePill];

  function setBalance(next: number | null): void {
    balance = next;
    for (const pill of pills) pill.set(next);
  }

  async function read(): Promise<void> {
    const id = mapId;
    if (id === null) return;
    const mine = (ticket += 1);
    let coins: HeartCoins;
    try {
      coins = await api.get(id);
    } catch (err) {
      // Offline or logged out: keep showing the last balance.
      if (mine === ticket) sheet.fail(err);
      return;
    }
    known.set(id, coins.balance);
    if (mine !== ticket) return;
    setBalance(coins.balance);
    sheet.show(coins);
  }

  // Back from another app: an hour away may have crossed midnight.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void read();
  });

  return {
    mapPill: mapPill.node,
    homePill: homePill.node,
    setMap: (next) => {
      if (next !== mapId) {
        ticket += 1;
        mapId = next;
        sheet.close();
        setBalance(next === null ? null : (known.get(next) ?? null));
      }
      void read();
    },
    refresh: read,
    lobbyLine: (id) => {
      const line = el('span', {
        class: 'lobby-heart-coins',
        'data-testid': 'lobby-heart-coins',
      });
      const fill = (n: number | null): void => {
        line.hidden = n === null;
        line.textContent = n === null ? '' : `💛 ${String(n)}`;
        if (n === null) line.removeAttribute('aria-label');
        else line.setAttribute('aria-label', HEART_COINS_TEXT.label(n));
      };
      fill(known.get(id) ?? null);
      api.get(id).then(
        (coins) => {
          known.set(id, coins.balance);
          fill(coins.balance);
        },
        () => {
          // Offline: the last balance seen (if any) stays.
        },
      );
      return line;
    },
    close: sheet.close,
    get isOpen() {
      return sheet.isOpen;
    },
    get debug() {
      return { mapId, balance, open: sheet.isOpen, page: sheet.page };
    },
  };
}
