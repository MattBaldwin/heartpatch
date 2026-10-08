import { hexKey, hexNeighbors, isTradingPost, type MapView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import { POST_SOON, postFlagLabel, postFlags, postReachLine } from './post-model.js';

/** A view where player 1 owns the tile next to the first post, joined to home by a strip. */
function connectedView(): MapView {
  const view = testView(2);
  const me = userId(1);
  const post = view.tiles.find(isTradingPost)!;
  // Walk from home towards the post, owning every tile on the way.
  const home = view.tiles.filter((t) => t.ownerUserId === me);
  const byKey = new Map<string, (typeof view.tiles)[number]>(view.tiles.map((t) => [hexKey(t), t]));
  const owned = new Set<string>(home.map(hexKey));
  let frontier = [...home];
  const parent = new Map<string, string>();
  let reached: string | null = null;
  while (frontier.length > 0 && reached === null) {
    const next = [];
    for (const t of frontier) {
      for (const n of hexNeighbors(t)) {
        const k = hexKey(n);
        const tile = byKey.get(k);
        if (!tile || owned.has(k) || parent.has(k) || tile.homeSlot !== null || isTradingPost(tile))
          continue;
        parent.set(k, hexKey(t));
        if (hexNeighbors(n).some((m) => m.q === post.q && m.r === post.r)) reached = k;
        next.push(tile);
      }
    }
    frontier = next;
  }
  const path = new Set<string>();
  for (let k: string | undefined = reached!; k && !owned.has(k); k = parent.get(k)) path.add(k);
  return {
    ...view,
    tiles: view.tiles.map((t) => (path.has(hexKey(t)) ? { ...t, ownerUserId: me } : t)),
  };
}

describe('postFlags', () => {
  it('lists every post in index order, with its name', () => {
    const flags = postFlags(testView(2), userId(1));
    expect(flags).toHaveLength(4);
    expect(flags.map((f) => f.tile.post?.index)).toEqual([0, 1, 2, 3]);
    expect(flags[0]!.name).toBe('Acorn Crossing');
  });

  it('says how I reach each one: a journey on day 1, connected once my land touches it', () => {
    const day1 = postFlags(testView(2), userId(1));
    // Every post is at least 2 steps from a home ring on day 1.
    for (const f of day1) {
      expect(f.reach?.kind).toBe('journey');
      if (f.reach?.kind === 'journey') expect(f.reach.distance).toBeGreaterThanOrEqual(2);
    }
    const later = postFlags(connectedView(), userId(1));
    expect(later.some((f) => f.reach?.kind === 'connected')).toBe(true);
  });

  it('knows nothing about reach for someone signed out', () => {
    expect(postFlags(testView(2), null).every((f) => f.reach === null)).toBe(true);
  });
});

describe('post words', () => {
  const flag = (reach: Parameters<typeof postReachLine>[0]) => ({
    tile: testView(1).tiles.find(isTradingPost)!,
    name: 'Lantern Post',
    reach,
  });

  it('labels the flags as the mockup does', () => {
    expect(postFlagLabel(flag({ kind: 'connected' }))).toBe('🔗 Lantern Post');
    expect(postFlagLabel(flag({ kind: 'journey', distance: 3 }))).toBe('🏮 Lantern Post · 3 tiles');
    expect(postFlagLabel(flag({ kind: 'journey', distance: 1 }))).toBe('🏮 Lantern Post · 1 tile');
    expect(postFlagLabel(flag(null))).toBe('🏮 Lantern Post');
  });

  it('tells the tile panel how far it is, and what opens there', () => {
    expect(postReachLine({ kind: 'connected' })).toMatch(/Your land reaches it/);
    expect(postReachLine({ kind: 'journey', distance: 3 })).toMatch(/^🧭 3 tiles from your land/);
    expect(postReachLine(null)).toBeNull();
    expect(POST_SOON).toMatch(/soon/);
  });
});
