import { HEART_COIN_RULES, type HeartCoins } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { createHeartCoinsStore } from './heart-coins-store.js';

const coins = (balance: number): HeartCoins => ({
  balance,
  today: { battle: 0, capture: 0, care: 0, sell: 0 },
  caps: { ...HEART_COIN_RULES.dailyCaps },
  resetsAt: '2026-10-21T00:00:00.000Z',
});

/** A fake API whose replies the test hands back one at a time, in any order. */
function setup() {
  const pending: { mapId: string; answer: (c: HeartCoins) => void; fail: () => void }[] = [];
  const shown: (number | null)[] = [];
  const fresh: number[] = [];
  const errors: unknown[] = [];
  const store = createHeartCoinsStore({
    api: {
      get: (mapId) =>
        new Promise<HeartCoins>((resolve, reject) => {
          pending.push({
            mapId,
            answer: resolve,
            fail: () => {
              reject(new Error('offline'));
            },
          });
        }),
    },
    onBalance: (b) => shown.push(b),
    onCoins: (c) => fresh.push(c.balance),
    onError: (e) => errors.push(e),
  });
  /** Answers the oldest call still waiting for `mapId`. */
  const answer = async (mapId: string, balance: number) => {
    const at = pending.findIndex((p) => p.mapId === mapId);
    const [call] = pending.splice(at, 1);
    call?.answer(coins(balance));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { store, pending, shown, fresh, errors, answer };
}

describe('createHeartCoinsStore', () => {
  it('reads the patch on screen and shows its balance', async () => {
    const t = setup();
    t.store.setUser('kid-a');
    void t.store.setMap('patch-1');
    await t.answer('patch-1', 12);
    expect(t.store.balance).toBe(12);
    expect(t.shown.at(-1)).toBe(12);
    expect(t.fresh).toEqual([12]);
  });

  it('drops a late reply for a patch no longer on screen', async () => {
    const t = setup();
    t.store.setUser('kid-a');
    void t.store.setMap('patch-1');
    void t.store.setMap('patch-2');
    await t.answer('patch-2', 7);
    await t.answer('patch-1', 99);
    expect(t.store.mapId).toBe('patch-2');
    expect(t.store.balance).toBe(7);
    expect(t.fresh).toEqual([7]);
  });

  it('drops an older read of the same patch that answers last', async () => {
    const t = setup();
    t.store.setUser('kid-a');
    void t.store.setMap('patch-1');
    void t.store.read();
    // The second read (after a care, say) answers first with the newer balance.
    const [older, newer] = t.pending.splice(0, 2);
    newer?.answer(coins(13));
    older?.answer(coins(12));
    await Promise.resolve();
    await Promise.resolve();
    expect(t.store.balance).toBe(13);
  });

  it('shows the last balance seen on a patch at once when coming back to it', async () => {
    const t = setup();
    t.store.setUser('kid-a');
    void t.store.setMap('patch-1');
    await t.answer('patch-1', 12);
    void t.store.setMap('patch-2');
    await t.answer('patch-2', 3);
    void t.store.setMap('patch-1');
    expect(t.store.balance).toBe(12);
  });

  it('keeps the last balance when a read fails, and says why', async () => {
    const t = setup();
    t.store.setUser('kid-a');
    void t.store.setMap('patch-1');
    await t.answer('patch-1', 12);
    void t.store.read();
    t.pending.shift()?.fail();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.store.balance).toBe(12);
    expect(t.errors).toHaveLength(1);
  });

  it("never shows one account's balance to the next on a shared device", async () => {
    const t = setup();
    t.store.setUser('kid-a');
    void t.store.setMap('patch-1');
    await t.answer('patch-1', 40);
    expect(t.store.balanceOf('patch-1', () => undefined)).toBe(40);

    t.store.setUser(null);
    expect(t.store.mapId).toBeNull();
    expect(t.shown.at(-1)).toBeNull();

    // Kid B shares the patch: nothing of kid A's shows while B's read is out.
    t.store.setUser('kid-b');
    void t.store.setMap('patch-1');
    expect(t.store.balance).toBeNull();
    const lines: number[] = [];
    expect(t.store.balanceOf('patch-1', (n) => lines.push(n))).toBeNull();
  });

  it('ignores a reply for the last account that lands after a sign-out', async () => {
    const t = setup();
    t.store.setUser('kid-a');
    void t.store.setMap('patch-1');
    const lines: number[] = [];
    t.store.balanceOf('patch-1', (n) => lines.push(n));
    t.store.setUser('kid-b');
    await t.answer('patch-1', 40);
    await t.answer('patch-1', 40);
    expect(t.store.balance).toBeNull();
    expect(lines).toEqual([]);
    expect(t.store.balanceOf('patch-1', () => undefined)).toBeNull();
  });

  it('reads nothing with no patch on screen', async () => {
    const t = setup();
    t.store.setUser('kid-a');
    await t.store.read();
    expect(t.pending).toHaveLength(0);
  });
});
