import type { PublicUser } from '@heartpatch/shared';
import type { GameClock } from '../inventory/game-clock.js';
import { el } from '../ui/dom.js';
import { heartCoinsApi, type HeartCoinsApi } from './heart-coins-api.js';
import { HEART_COINS_TEXT, type HeartCoinsPage } from './heart-coins-model.js';
import { createHeartCoinsSheet } from './heart-coins-sheet.js';
import { createHeartCoinsStore } from './heart-coins-store.js';
import { createHeartPill } from './heart-pill.js';
import '../ui/coins/coins.css';
import './heart-coins.css';

// Heart Coins on screen (#601): one 💛 pill on the map's patch-name card,
// one on Home's peek bar, a "💛 42" line on each patch-list card, and the
// sheet a pill opens. Each patch has its own balance, read fresh from
// `GET /maps/:mapId/heart-coins` whenever the map or home comes up, a care
// sheet closes, the app comes back, the sheet opens, or the patch's
// midnight passes with the sheet open. None on the Tutorial Glade (main
// passes null there): it pays none.

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
  /** Who's logged in: another account (or none) forgets every balance seen. */
  setUser: (user: PublicUser | null) => void;
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
  const clock: Pick<GameClock, 'msUntil'> = {
    msUntil: (iso) => Math.max(0, Date.parse(iso) - options.now()),
  };
  const sheet = createHeartCoinsSheet({
    root: options.root,
    clock,
    onExpired: () => void store.read(),
  });
  const openSheet = (): void => {
    if (store.mapId === null) return;
    sheet.open();
    void store.read();
  };
  const mapPill = createHeartPill('map', openSheet);
  const homePill = createHeartPill('home', openSheet);
  const store = createHeartCoinsStore({
    api: options.api ?? heartCoinsApi,
    onBalance: (balance) => {
      mapPill.set(balance);
      homePill.set(balance);
    },
    onCoins: sheet.show,
    // Offline or logged out: the pill keeps the last balance; the sheet says why.
    onError: sheet.fail,
  });

  // Back from another app: an hour away may have crossed midnight.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void store.read();
  });

  return {
    mapPill: mapPill.node,
    homePill: homePill.node,
    setUser: (user) => {
      sheet.close();
      store.setUser(user?.id ?? null);
    },
    setMap: (mapId) => {
      if (mapId !== store.mapId) sheet.close();
      void store.setMap(mapId);
    },
    refresh: store.read,
    lobbyLine: (mapId) => {
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
      fill(store.balanceOf(mapId, fill));
      return line;
    },
    close: sheet.close,
    get isOpen() {
      return sheet.isOpen;
    },
    get debug() {
      return {
        mapId: store.mapId,
        balance: store.balance,
        open: sheet.isOpen,
        page: sheet.page,
      };
    },
  };
}
