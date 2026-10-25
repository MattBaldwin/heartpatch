import { describe, expect, it, vi } from 'vitest';
import type { MapView, PublicRoad, RoadsView } from '@heartpatch/shared';
import { MAP_ID, testView, testWildIsle, userId } from '../map/test-view.js';
import { createRoadFeed, isWildIsleView } from './road-feed.js';

const ME = userId(1);
const road = (q: number, r: number, level = 1): PublicRoad => ({
  q,
  r,
  ownerUserId: ME,
  level,
});
const at = (view: MapView, seq: number): MapView => ({ ...view, seq });
const wild = testWildIsle();

/** A read the test finishes by hand. */
function slowFetch() {
  const waiting: ((view: RoadsView) => void)[] = [];
  const fetch = vi.fn(
    () =>
      new Promise<RoadsView>((resolve) => {
        waiting.push(resolve);
      }),
  );
  return { fetch, finish: (roads: PublicRoad[]) => waiting.shift()?.({ roads }) };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('road feed (#621 W1-6)', () => {
  it('knows a Wild Isle from a Cozy Patch', () => {
    expect(isWildIsleView(wild)).toBe(true);
    expect(isWildIsleView(testView())).toBe(false);
  });

  it('never asks about roads on a Cozy Patch', async () => {
    const fetch = vi.fn(() => Promise.resolve({ roads: [] }));
    const feed = createRoadFeed(fetch, () => undefined);
    feed.follow(testView());
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(feed.loaded).toBe(false);
  });

  it('reads the roads once per seq, and again when the seq moves', async () => {
    const fetch = vi.fn(() => Promise.resolve({ roads: [road(1, 1)] }));
    const changed = vi.fn();
    const feed = createRoadFeed(fetch, changed);
    feed.follow(at(wild, 5));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(MAP_ID);
    expect(feed.roads).toEqual([road(1, 1)]);
    expect(feed.loaded).toBe(true);
    feed.follow(at(wild, 5));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    feed.follow(at(wild, 6));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('keeps one read out at a time and reads once more if the map moved meanwhile', async () => {
    const { fetch, finish } = slowFetch();
    const feed = createRoadFeed(fetch, () => undefined);
    feed.follow(at(wild, 1));
    feed.follow(at(wild, 2));
    feed.follow(at(wild, 3));
    expect(fetch).toHaveBeenCalledTimes(1);
    finish([road(0, 0)]);
    await flush();
    // The first answer may be stale: it isn't used; one more read follows.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(feed.roads).toEqual([]);
    finish([road(2, 2)]);
    await flush();
    expect(feed.roads).toEqual([road(2, 2)]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('applies my own command at once, and a take-up removes the road', () => {
    const feed = createRoadFeed(
      () => Promise.resolve({ roads: [] }),
      () => undefined,
    );
    feed.apply({ q: 3, r: -1, road: { level: 1 }, items: {}, refund: {} }, ME);
    expect(feed.roads).toEqual([road(3, -1, 1)]);
    feed.apply({ q: 3, r: -1, road: { level: 2 }, items: {}, refund: {} }, ME);
    expect(feed.roads).toEqual([road(3, -1, 2)]);
    feed.apply({ q: 3, r: -1, road: null, items: {}, refund: {} }, ME);
    expect(feed.roads).toEqual([]);
  });

  it('does not let a read that began before my command undo it', async () => {
    const { fetch, finish } = slowFetch();
    const feed = createRoadFeed(fetch, () => undefined);
    feed.follow(at(wild, 1));
    feed.apply({ q: 1, r: 1, road: { level: 1 }, items: {}, refund: {} }, ME);
    finish([]);
    await flush();
    finish([road(1, 1)]);
    await flush();
    expect(feed.roads).toEqual([road(1, 1)]);
  });

  it('tries again on the next change after a failed read', async () => {
    const fetch = vi
      .fn<() => Promise<RoadsView>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ roads: [road(4, 4)] });
    const feed = createRoadFeed(fetch, () => undefined);
    feed.follow(at(wild, 1));
    await flush();
    expect(feed.loaded).toBe(false);
    feed.follow(at(wild, 1));
    await flush();
    expect(feed.roads).toEqual([road(4, 4)]);
  });

  it('forgets the roads when it leaves a Wild Isle', async () => {
    const feed = createRoadFeed(
      () => Promise.resolve({ roads: [road(1, 1)] }),
      () => undefined,
    );
    feed.follow(at(wild, 1));
    await flush();
    feed.follow(testView());
    expect(feed.roads).toEqual([]);
    expect(feed.loaded).toBe(false);
  });
});
