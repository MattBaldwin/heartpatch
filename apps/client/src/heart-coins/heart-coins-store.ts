import type { HeartCoins } from '@heartpatch/shared';
import type { HeartCoinsApi } from './heart-coins-api.js';

// Heart Coins (#601): which patch's balance is on screen, for whom, and the
// last balance seen on each patch. No DOM, so it's tested on its own; the
// screen (heart-coins.ts) draws what it says. A balance is one player's
// (plan §2): a new account starts with nothing remembered.

export interface HeartCoinsStoreOptions {
  api: Pick<HeartCoinsApi, 'get'>;
  /** The balance of the patch on screen changed (null: none to show). */
  onBalance: (balance: number | null) => void;
  /** A fresh reply for the patch on screen. */
  onCoins: (coins: HeartCoins) => void;
  /** Reading the patch on screen failed (the last balance stays). */
  onError: (err: unknown) => void;
}

export interface HeartCoinsStore {
  /** Who's logged in; another account (or none) forgets everything. */
  setUser: (userId: string | null) => void;
  /** The patch on screen, or null: shows its last known balance, then reads it. */
  setMap: (mapId: string | null) => Promise<void>;
  /** Reads the patch on screen again (none: does nothing). */
  read: () => Promise<void>;
  /** A patch's balance for the patch list: the last seen now (or null), then `fill` with a fresh one. */
  balanceOf: (mapId: string, fill: (balance: number) => void) => number | null;
  readonly mapId: string | null;
  readonly balance: number | null;
}

export function createHeartCoinsStore(options: HeartCoinsStoreOptions): HeartCoinsStore {
  const { api } = options;
  let userId: string | null = null;
  let mapId: string | null = null;
  let balance: number | null = null;
  /** Bumped on every read, map or user change, so a late reply for an old one is dropped. */
  let ticket = 0;
  /** Bumped on a user change only: the patch list's late replies check it. */
  let generation = 0;
  /** The last balance seen on each patch, so a redrawn patch list doesn't flicker. */
  const known = new Map<string, number>();

  const setBalance = (next: number | null): void => {
    balance = next;
    options.onBalance(next);
  };

  async function read(): Promise<void> {
    const id = mapId;
    if (id === null) return;
    const mine = (ticket += 1);
    const gen = generation;
    let coins: HeartCoins;
    try {
      coins = await api.get(id);
    } catch (err) {
      if (mine === ticket) options.onError(err);
      return;
    }
    if (gen === generation) known.set(id, coins.balance);
    if (mine !== ticket) return;
    setBalance(coins.balance);
    options.onCoins(coins);
  }

  return {
    setUser: (next) => {
      if (next === userId) return;
      userId = next;
      generation += 1;
      ticket += 1;
      known.clear();
      mapId = null;
      setBalance(null);
    },
    setMap: (next) => {
      if (next !== mapId) {
        ticket += 1;
        mapId = next;
        setBalance(next === null ? null : (known.get(next) ?? null));
      }
      return read();
    },
    read,
    balanceOf: (id, fill) => {
      const gen = generation;
      api.get(id).then(
        (coins) => {
          if (gen !== generation) return;
          known.set(id, coins.balance);
          fill(coins.balance);
        },
        () => {
          // Offline: the last balance seen (if any) stays.
        },
      );
      return known.get(id) ?? null;
    },
    get mapId() {
      return mapId;
    },
    get balance() {
      return balance;
    },
  };
}
