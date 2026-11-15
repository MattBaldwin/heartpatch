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
    const fetchBoss = vi.fn(async () => visit());
    const store = createBossStore({ fetchBoss, fetchNames: async () => new Map() });
    await store.setMap('m1');
    expect(store.visit?.tile).toEqual({ q: 0, r: 1 });
    await store.setMap(null);
    expect(store.visit).toBeNull();
  });

  it('only asks the catalog for names once the species is met', async () => {
    const fetchNames = vi.fn(async () => new Map([['rakelet', 'Rakelet']]));
    const unmet = createBossStore({ fetchBoss: async () => visit(), fetchNames });
    await unmet.setMap('m1');
    expect(fetchNames).not.toHaveBeenCalled();
    const met = createBossStore({
      fetchBoss: async () => visit({ species: 'rakelet' }),
      fetchNames,
    });
    await met.setMap('m1');
    expect(met.nameOf('rakelet')).toBe('Rakelet');
    expect(met.nameOf('other')).toBeNull();
  });

  it('keeps what it had when a fetch fails', async () => {
    let fail = false;
    const store = createBossStore({
      fetchBoss: async () => {
        if (fail) throw new Error('offline');
        return visit();
      },
      fetchNames: async () => new Map(),
    });
    await store.setMap('m1');
    fail = true;
    await store.refresh();
    expect(store.visit).not.toBeNull();
  });

  it('refetches on boss.appeared for this map only, then tells the patch line', async () => {
    const onAppeared = vi.fn();
    const fetchBoss = vi.fn(async () => visit());
    const store = createBossStore({ fetchBoss, fetchNames: async () => new Map(), onAppeared });
    await store.setMap('m1');
    store.liveEvent(appeared('other'));
    expect(fetchBoss).toHaveBeenCalledTimes(1);
    store.liveEvent(appeared('m1'));
    await vi.waitFor(() => expect(onAppeared).toHaveBeenCalledTimes(1));
    expect(onAppeared.mock.calls[0]?.[1]).toBe('m1');
  });

  it('wakes its listeners when the visit ends', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T23:59:00Z'));
    const store = createBossStore({
      fetchBoss: async () => visit(),
      fetchNames: async () => new Map(),
    });
    await store.setMap('m1');
    const changed = vi.fn();
    store.onChange(changed);
    vi.advanceTimersByTime(61_000);
    expect(changed).toHaveBeenCalled();
    store.dispose();
  });
});
