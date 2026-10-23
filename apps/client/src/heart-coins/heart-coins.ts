import type { PublicUser } from '@heartpatch/shared';
import type { GameClock } from '../inventory/game-clock.js';
import { el } from '../ui/dom.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
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
  /** The upkeep order changed (#601): whoever shows buildings may read them again. */
  onUpkeepOrder?: () => void;
  /** The seasons on at an instant on the patch on screen (the upkeep list's sleeping Pumpkin Barn). */
  seasons?: (at: Date) => readonly string[] | null;
  /** A fresh reply came in (`pausedThisMorning` may have changed: the morning card reads it). */
  onCoins?: () => void;
}

/**
 * The buildings that fell asleep for unpaid upkeep at a patch's latest
 * morning (#601 PR 9), for the morning card. `morning` names that morning
 * (the reply's next one), so the card tells it once.
 */
export interface UpkeepPaused {
  readonly mapId: string;
  readonly morning: string;
  /** Each one and its level (from `upkeep.due`), so the card can say its 💛. */
  readonly buildings: readonly { readonly buildingId: string; readonly level: number }[];
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
  /** Opens the sheet at its morning upkeep list (a resource building's card, #601). */
  openUpkeep: () => void;
  /** Reads the balance of the patch on screen again (a failed read keeps the last one). */
  refresh: () => Promise<void>;
  /**
   * The patch on screen's buildings that fell asleep for upkeep this
   * morning, from its latest reply (null: none read yet). The bag's settle
   * charges the morning and then reads again (`refresh`). A pause is stamped
   * with the first unpaid morning, so after days away an older pause isn't
   * listed (the "since you were last here" question on #601).
   */
  readonly upkeepPaused: UpkeepPaused | null;
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
    ...(options.seasons ? { seasons: options.seasons } : {}),
    // The kid's upkeep order (#601 Q5): saved, then the sheet reads it back.
    onUpkeepOrder: async (ids) => {
      const mapId = store.mapId;
      if (mapId === null) return;
      await api.upkeepOrder(mapId, ids, newIdempotencyKey());
      void store.read();
      options.onUpkeepOrder?.();
    },
  });
  const api = options.api ?? heartCoinsApi;
  const openSheet = (): void => {
    if (store.mapId === null) return;
    sheet.open();
    void store.read();
  };
  let upkeepPaused: UpkeepPaused | null = null;
  const mapPill = createHeartPill('map', openSheet);
  const homePill = createHeartPill('home', openSheet);
  const store = createHeartCoinsStore({
    api,
    onBalance: (balance) => {
      mapPill.set(balance);
      homePill.set(balance);
    },
    onCoins: (coins) => {
      sheet.show(coins);
      const mapId = store.mapId;
      const upkeep = coins.upkeep;
      upkeepPaused =
        mapId === null || !upkeep
          ? null
          : {
              mapId,
              morning: upkeep.nextMorningAt,
              buildings: (upkeep.pausedThisMorning ?? []).map((p) => ({
                buildingId: p.buildingId,
                level: upkeep.due.find((d) => d.buildingRowId === p.buildingRowId)?.level ?? 1,
              })),
            };
      options.onCoins?.();
    },
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
      upkeepPaused = null;
      store.setUser(user?.id ?? null);
    },
    setMap: (mapId) => {
      if (mapId !== store.mapId) {
        sheet.close();
        upkeepPaused = null;
      }
      void store.setMap(mapId);
    },
    refresh: store.read,
    openUpkeep: () => {
      if (store.mapId === null) return;
      sheet.open();
      sheet.scrollToUpkeep();
      void store.read();
    },
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
    get upkeepPaused() {
      return upkeepPaused;
    },
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
