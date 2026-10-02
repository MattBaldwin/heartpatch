import type { MapView, WsEventMessage } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import { MapSync, NOT_A_MEMBER_MESSAGE, RESYNC_RETRY_MAX_MS, RESYNC_RETRY_MS } from './map-sync.js';
import { MAP_ID, testView, userId } from './test-view.js';

/** A fetch the test settles by hand, so it can act while one is in flight. */
interface PendingFetch {
  mapId: string;
  resolve: (view: MapView) => void;
  reject: (err: unknown) => void;
}

function setup() {
  const fetches: PendingFetch[] = [];
  const calls: string[] = [];
  const redraws: MapView[] = [];
  const left: string[] = [];
  const sync = new MapSync({
    fetchView: (mapId) =>
      new Promise<MapView>((resolve, reject) => {
        fetches.push({ mapId, resolve, reject });
      }),
    socket: () => ({
      subscribe: (mapId, afterSeq) => calls.push(`subscribe ${mapId} ${String(afterSeq)}`),
      unsubscribe: () => calls.push('unsubscribe'),
    }),
    onRedraw: (state) => redraws.push(state.view),
    onLeave: (message) => left.push(message),
  });
  /** Settles the latest fetch and lets its callbacks run. */
  const answer = async (view: MapView | Error) => {
    const pending = fetches.at(-1)!;
    if (view instanceof Error) pending.reject(view);
    else pending.resolve(view);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { sync, fetches, calls, redraws, left, answer };
}

const at = (seq: number, view = testView(1)): MapView => ({ ...view, seq });

const event = (type: string, data: Record<string, unknown>, seq: number): WsEventMessage => ({
  v: 1,
  type,
  mapId: MAP_ID,
  seq,
  at: '2026-10-02T12:00:00.000Z',
  data,
});

const joined = (seq: number) =>
  event(
    'member.joined',
    { userId: userId(2), username: 'keeper2', homeSlot: 1, heartSeed: { q: 0, r: 8 } },
    seq,
  );

/** Opens MAP_ID with a view at `seq`. */
async function opened(seq = 5) {
  const t = setup();
  const opening = t.sync.open(MAP_ID);
  await t.answer(at(seq));
  await opening;
  t.calls.length = 0;
  return t;
}

describe('MapSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows the map live from the view's seq", async () => {
    const { sync, calls, answer } = setup();
    const opening = sync.open(MAP_ID);
    expect(calls).toEqual([]);
    await answer(at(42));
    const state = await opening;
    expect(state?.view.seq).toBe(42);
    expect(calls).toEqual([`subscribe ${MAP_ID} 42`]);
  });

  it("rejects with the server's message when the map can't be fetched", async () => {
    const { sync, fetches, calls } = setup();
    const opening = sync.open(MAP_ID);
    fetches[0]!.reject(new ApiRequestError('NOT_FOUND', 'Gone!'));
    await expect(opening).rejects.toThrow('Gone!');
    expect(sync.state).toBeNull();
    expect(calls).toEqual([]);
  });

  it('on ws.resync, refetches once and re-subscribes from the fresh seq, without looping', async () => {
    const { sync, fetches, calls, redraws, answer } = await opened(5);
    sync.serverResync(MAP_ID);
    sync.serverResync(MAP_ID); // a second one while the first is in flight is the same resync
    expect(fetches).toHaveLength(2);
    expect(calls).toEqual(['unsubscribe']);

    await answer(at(900, testView(2)));
    expect(calls).toEqual(['unsubscribe', `subscribe ${MAP_ID} 900`]);
    expect(redraws).toHaveLength(1);
    expect(sync.state?.view.seq).toBe(900);
    expect(sync.state?.member(userId(2))).toBeDefined();

    // Nothing else happens on its own: no refetch loop.
    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_MAX_MS * 4);
    expect(fetches).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it('ignores a resync for another map', async () => {
    const { sync, fetches } = await opened();
    sync.serverResync('0190a8c4-0000-7000-8000-0000000000ff');
    expect(fetches).toHaveLength(1);
  });

  it('refetches when a member joins, and ignores events until the fresh view is in', async () => {
    const { sync, fetches, calls, redraws, answer } = await opened(5);
    sync.event(joined(6));
    expect(fetches).toHaveLength(2);
    sync.event(event('map.updated', { pvpMode: 'off' }, 7)); // already in the view being fetched
    sync.event(joined(8));
    expect(fetches).toHaveLength(2);
    expect(sync.state?.view.map.pvpMode).toBe('gentle');

    await answer(at(8, testView(2)));
    expect(calls).toEqual(['unsubscribe', `subscribe ${MAP_ID} 8`]);
    expect(redraws.map((v) => v.seq)).toEqual([8]);
  });

  it("redraws, without refetching, when a member's Keeper changes clothes (#43)", async () => {
    const { sync, fetches, redraws } = await opened(5);
    sync.event(event('outfit.changed', { userId: userId(1), wearing: ['witch-hat'] }, 6));
    expect(fetches).toHaveLength(1);
    expect(redraws.map((v) => v.members[0]?.keeper?.wearing)).toEqual([['witch-hat']]);
  });

  it('applies a settings change without refetching', async () => {
    const { sync, fetches } = await opened();
    sync.event(event('map.updated', { pvpMode: 'on' }, 6));
    expect(sync.state?.view.map.pvpMode).toBe('on');
    expect(fetches).toHaveLength(1);
  });

  it('retries a failed resync with growing waits, keeping the old map meanwhile', async () => {
    const { sync, fetches, answer, left } = await opened(5);
    sync.serverResync(MAP_ID);
    await answer(new ApiRequestError('OFFLINE', 'offline'));
    expect(sync.state?.view.seq).toBe(5);
    expect(fetches).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_MS - 1);
    expect(fetches).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetches).toHaveLength(3);

    await answer(new ApiRequestError('INTERNAL', 'oops'));
    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_MS * 2 - 1);
    expect(fetches).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetches).toHaveLength(4);

    await answer(at(12));
    expect(sync.state?.view.seq).toBe(12);
    expect(left).toEqual([]);
  });

  it('leaves the map when a resync finds the player is no longer a member', async () => {
    const { sync, answer, left, fetches } = await opened();
    sync.event(event('member.removed', { userId: userId(1), releasedTiles: 7 }, 6));
    await answer(new ApiRequestError('NOT_FOUND', "We couldn't find that."));
    expect(left).toEqual([NOT_A_MEMBER_MESSAGE]);
    expect(sync.state).toBeNull();
    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_MAX_MS);
    expect(fetches).toHaveLength(2);
  });

  it("leaves the map when the server ends this map's subscription", async () => {
    const { sync, left } = await opened();
    sync.serverError({ code: 'FORBIDDEN', message: "You can't do that here.", mapId: 'other' });
    expect(left).toEqual([]);
    sync.serverError({ code: 'RATE_LIMITED', message: 'Slow down!' });
    expect(left).toEqual([]);
    sync.serverError({ code: 'FORBIDDEN', message: "You can't do that here.", mapId: MAP_ID });
    expect(left).toEqual([NOT_A_MEMBER_MESSAGE]);
    expect(sync.state).toBeNull();
  });

  it('restarts a resync that a failed open cut short, so the map stays live', async () => {
    const { sync, fetches, calls, redraws, answer } = await opened(5);
    sync.event(joined(6)); // resync in flight: unsubscribed, fetch 2 pending
    const reopening = sync.open(MAP_ID); // e.g. "Visit patch" again, while offline
    fetches[2]!.reject(new ApiRequestError('OFFLINE', 'offline'));
    await expect(reopening).rejects.toThrow('offline');

    // The cut-short resync's answer is ignored; a fresh one is already fetching.
    expect(fetches).toHaveLength(4);
    fetches[1]!.resolve(at(6, testView(2)));
    await vi.advanceTimersByTimeAsync(0);
    expect(redraws).toEqual([]);

    await answer(at(7, testView(2)));
    expect(calls.at(-1)).toBe(`subscribe ${MAP_ID} 7`);
    expect(sync.state?.view.seq).toBe(7);
    sync.event(event('map.updated', { pvpMode: 'off' }, 8));
    expect(sync.state?.view.map.pvpMode).toBe('off');
  });

  it("doesn't start a second resync when one began during the failed open", async () => {
    const { sync, fetches, calls, answer } = await opened(5);
    const reopening = sync.open(MAP_ID); // fetch 1
    sync.event(joined(6)); // resync during the open: fetch 2
    fetches[1]!.reject(new ApiRequestError('OFFLINE', 'offline'));
    await expect(reopening).rejects.toThrow('offline');
    expect(fetches).toHaveLength(3);

    await answer(at(6, testView(2)));
    expect(calls).toEqual(['unsubscribe', `subscribe ${MAP_ID} 6`]);
  });

  it('drops a resync that began during an open that then succeeded', async () => {
    const { sync, fetches, calls, redraws } = await opened(5);
    const reopening = sync.open(MAP_ID); // fetch 1
    sync.event(joined(6)); // resync on the old copy: fetch 2
    fetches[1]!.resolve(at(10, testView(2)));
    expect((await reopening)?.view.seq).toBe(10);
    fetches[2]!.resolve(at(6, testView(2)));
    await vi.advanceTimersByTimeAsync(RESYNC_RETRY_MAX_MS);
    expect(redraws).toEqual([]);
    expect(calls).toEqual(['unsubscribe', `subscribe ${MAP_ID} 10`]);
    expect(sync.state?.view.seq).toBe(10);
    // And the new copy is live.
    sync.event(event('map.updated', { pvpMode: 'off' }, 11));
    expect(sync.state?.view.map.pvpMode).toBe('off');
  });

  it("never lets an old map's late resync take over a different map", async () => {
    const { sync, fetches, calls, redraws } = await opened(5);
    const other = '0190a8c4-0000-7000-8000-0000000000bb';
    const visiting = sync.open(other); // fetch 1
    sync.serverResync(MAP_ID); // resync for the map still on screen: fetch 2
    const otherView = testView(1);
    fetches[1]!.resolve({ ...otherView, map: { ...otherView.map, id: other }, seq: 3 });
    expect((await visiting)?.id).toBe(other);
    fetches[2]!.resolve(at(9));
    await vi.advanceTimersByTimeAsync(0);
    expect(redraws).toEqual([]);
    expect(calls.at(-1)).toBe(`subscribe ${other} 3`);
    expect(calls.filter((c) => c.startsWith('subscribe'))).toHaveLength(1);
  });

  it('keeps a live map live when a failed open came in between', async () => {
    const { sync, fetches, calls } = await opened(5);
    const reopening = sync.open(MAP_ID);
    fetches[1]!.reject(new ApiRequestError('NOT_FOUND', 'Gone!'));
    await expect(reopening).rejects.toThrow('Gone!');
    expect(fetches).toHaveLength(2); // nothing to restart
    expect(calls).toEqual([]);
    sync.event(event('map.updated', { pvpMode: 'on' }, 6));
    expect(sync.state?.view.map.pvpMode).toBe('on');
  });

  it('drops a fetch that finishes after the map was closed or swapped', async () => {
    const { sync, fetches, calls, redraws } = await opened(5);
    sync.serverResync(MAP_ID);
    sync.close();
    expect(calls).toEqual(['unsubscribe', 'unsubscribe']);
    fetches[1]!.resolve(at(9));
    await vi.advanceTimersByTimeAsync(0);
    expect(redraws).toEqual([]);
    expect(sync.state).toBeNull();

    // Two opens in a row: only the second one shows.
    const first = sync.open(MAP_ID);
    const second = sync.open(MAP_ID);
    fetches[3]!.resolve(at(20));
    fetches[2]!.resolve(at(10));
    expect(await second).not.toBeNull();
    expect(await first).toBeNull();
    expect(sync.state?.view.seq).toBe(20);
  });
});
