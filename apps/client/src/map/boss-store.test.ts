import type { BossVisit, WsEventMessage } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBossStore } from './boss-store.js';

const visit = (over: Partial<BossVisit> = {}): BossVisit => ({
  window: { id: '2026-11-09', endsAt: '2026-11-16T00:00:00Z' },
  tile: { q: 0, r: 1 },
  species: null,
  state: 'here',
  triesLeftToday: 3,
  ...over,
});
const appeared = (mapId: string): WsEventMessage =>
  ({
    type: 'boss.appeared',
    mapId,
    seq: 1,
    at: '2026-11-14T12:00:00Z',
    data: { window: '2026-11-09', q: 0, r: 1, endsAt: '2026-11-16T00:00:00Z' },
  }) as unknown as WsEventMessage;

afterEach(() => vi.useRealTimers());

describe('createBossStore', () => {
  it('fetches the map on screen and clears with none', async () => {
    const fetchBoss = vi.fn(() => Promise.resolve(visit()));
    const store = createBossStore({
      fetchBoss,
      fetchNames: () => Promise.resolve(new Map<string, string>()),
    });
    await store.setMap('m1');
    expect(store.visit?.tile).toEqual({ q: 0, r: 1 });
    await store.setMap(null);
    expect(store.visit).toBeNull();
  });

  it('only asks the catalog for names once the species is met', async () => {
    const fetchNames = vi.fn(() => Promise.resolve(new Map([['rakelet', 'Rakelet']])));
    const unmet = createBossStore({ fetchBoss: () => Promise.resolve(visit()), fetchNames });
    await unmet.setMap('m1');
    expect(fetchNames).not.toHaveBeenCalled();
    const met = createBossStore({
      fetchBoss: () => Promise.resolve(visit({ species: 'rakelet' })),
      fetchNames,
    });
    await met.setMap('m1');
    expect(met.nameOf('rakelet')).toBe('Rakelet');
    expect(met.nameOf('other')).toBeNull();
  });

  it('keeps what it had when a fetch fails', async () => {
    let fail = false;
    const store = createBossStore({
      fetchBoss: () => {
        if (fail) return Promise.reject(new Error('offline'));
        return Promise.resolve(visit());
      },
      fetchNames: () => Promise.resolve(new Map<string, string>()),
    });
    await store.setMap('m1');
    fail = true;
    await store.refresh();
    expect(store.visit).not.toBeNull();
  });

  it('refetches on boss.appeared for this map only, then tells the patch line', async () => {
    const onAppeared = vi.fn();
    const fetchBoss = vi.fn(() => Promise.resolve(visit()));
    const store = createBossStore({
      fetchBoss,
      fetchNames: () => Promise.resolve(new Map<string, string>()),
      onAppeared,
    });
    await store.setMap('m1');
    store.liveEvent(appeared('other'));
    expect(fetchBoss).toHaveBeenCalledTimes(1);
    store.liveEvent(appeared('m1'));
    await vi.waitFor(() => {
      expect(onAppeared).toHaveBeenCalledTimes(1);
    });
    expect(onAppeared.mock.calls[0]?.[1]).toBe('m1');
  });

  it('drops a slow reply for a map that is no longer on screen', async () => {
    let finishA: (v: BossVisit) => void = () => undefined;
    const store = createBossStore({
      fetchBoss: (id) =>
        id === 'a'
          ? new Promise<BossVisit>((resolve) => {
              finishA = resolve;
            })
          : Promise.resolve(visit({ triesLeftToday: 1 })),
      fetchNames: () => Promise.resolve(new Map<string, string>()),
    });
    const slow = store.setMap('a');
    await store.setMap('b');
    finishA(visit({ triesLeftToday: 3 }));
    await slow;
    expect(store.mapId).toBe('b');
    expect(store.visit?.triesLeftToday).toBe(1);
  });

  it('wakes its listeners when the visit ends', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T23:59:00Z'));
    const store = createBossStore({
      fetchBoss: () => Promise.resolve(visit()),
      fetchNames: () => Promise.resolve(new Map<string, string>()),
    });
    await store.setMap('m1');
    const changed = vi.fn();
    store.onChange(changed);
    vi.advanceTimersByTime(61_000);
    expect(changed).toHaveBeenCalled();
    store.dispose();
  });
});

describe('the Christmas Eve bar from live events (#37 X4)', () => {
  const event = (type: string, mapId: string, data: object): WsEventMessage =>
    ({ type, mapId, seq: 2, at: '2026-12-24T18:00:00Z', data }) as unknown as WsEventMessage;
  const storeOnMap = async () => {
    const store = createBossStore({
      fetchBoss: () => Promise.resolve(visit()),
      fetchNames: () => Promise.resolve(new Map<string, string>()),
    });
    await store.setMap('m1');
    return store;
  };

  it('moves with boss.chipped and tells listeners', async () => {
    const store = await storeOnMap();
    const seen = vi.fn();
    store.onChange(seen);
    store.liveEvent(event('boss.chipped', 'm1', { window: '2026-12-21', chipped: 80, goal: 200 }));
    expect(store.eveBar).toEqual({ goal: 200, chipped: 80, state: 'open' });
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('never goes back, and a fall stays a fall', async () => {
    const store = await storeOnMap();
    store.liveEvent(
      event('boss.fell', 'm1', {
        window: '2026-12-21',
        fellAt: '2026-12-24T19:00:00Z',
        chipped: 205,
        goal: 200,
      }),
    );
    store.liveEvent(event('boss.chipped', 'm1', { window: '2026-12-21', chipped: 120, goal: 200 }));
    expect(store.eveBar).toEqual({ goal: 200, chipped: 205, state: 'fell' });
  });
  it('ignores another map, junk, and forgets the bar when the map changes', async () => {
    const store = await storeOnMap();
    store.liveEvent(
      event('boss.chipped', 'other', { window: '2026-12-21', chipped: 80, goal: 200 }),
    );
    store.liveEvent(event('boss.chipped', 'm1', { nope: true }));
    expect(store.eveBar).toBeNull();
    store.liveEvent(event('boss.chipped', 'm1', { window: '2026-12-21', chipped: 80, goal: 200 }));
    await store.setMap('m2');
    expect(store.eveBar).toBeNull();
  });
});
