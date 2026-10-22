import { hexKey, hexNeighbors, type CommunityView, type MapView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import { KEY_TEXT, keyFlags, keyHuntOn, newMaps } from './key-hunt-view.js';

const ME = userId(1);

/** The test map with its first village won by `owner` and its cellar at `cellar`. */
function wonView(owner: string, cellar: CommunityView['cellar']): MapView {
  const view = testView(2);
  const [first, ...rest] = view.communities!;
  return { ...view, communities: [{ ...first!, ownerUserId: owner, cellar }, ...rest] };
}

/** A wild tile two steps or more from all my land, for the key to hide on. */
function farTile(view: MapView) {
  const mine = new Set(view.tiles.filter((t) => t.ownerUserId === ME).map(hexKey));
  const near = (t: { q: number; r: number }) =>
    mine.has(hexKey(t)) || hexNeighbors(t).some((n) => mine.has(hexKey(n)));
  return view.tiles.find((t) => t.ownerUserId === null && t.communityId === null && !near(t))!;
}

describe('the key hunt on the map (#306 PR 2c)', () => {
  it("shows the key's block on its tile to its winner, and whether they can dig", () => {
    const base = wonView(ME, undefined);
    const key = farTile(base);
    const view = wonView(ME, { state: 'hunt', keyTile: { q: key.q, r: key.r } });
    const away = keyHuntOn(view, key, ME);
    expect(away).toMatchObject({ kind: 'key', inReach: false });
    expect(away?.community.id).toBe(view.communities![0]!.id);

    // A neighbour becomes mine: in reach, whoever holds the key's tile.
    const beside = hexNeighbors(key)[0]!;
    const near: MapView = {
      ...view,
      tiles: view.tiles.map((t) =>
        t.q === beside.q && t.r === beside.r
          ? { ...t, ownerUserId: ME }
          : t.q === key.q && t.r === key.r
            ? { ...t, ownerUserId: userId(2) }
            : t,
      ),
    };
    expect(keyHuntOn(near, key, ME)).toMatchObject({ kind: 'key', inReach: true });
    // Nobody else sees it (their view never has `cellar`, but even so).
    expect(keyHuntOn(near, key, userId(2))).toBeNull();
  });

  it('shows the cellar door on my won square in every state, and nothing on others', () => {
    for (const state of ['hunt', 'key', 'open'] as const) {
      const view = wonView(ME, state === 'hunt' ? { state, keyTile: { q: 0, r: 0 } } : { state });
      const square = view.tiles.find(
        (t) => t.q === view.communities![0]!.square.q && t.r === view.communities![0]!.square.r,
      )!;
      expect(keyHuntOn(view, square, ME)).toMatchObject({ kind: 'square', state });
    }
    const theirs = wonView(userId(2), undefined);
    const square = theirs.tiles.find(
      (t) => t.q === theirs.communities![0]!.square.q && t.r === theirs.communities![0]!.square.r,
    )!;
    expect(keyHuntOn(theirs, square, ME)).toBeNull();
  });

  it('flags the key only while I hunt for it', () => {
    const key = { q: 0, r: 0 };
    const hunting = wonView(ME, { state: 'hunt', keyTile: key });
    expect(keyFlags(hunting, ME)).toEqual([
      { id: `key:${hunting.communities![0]!.id}`, community: hunting.communities![0], tile: key },
    ]);
    expect(keyFlags(wonView(ME, { state: 'key' }), ME)).toEqual([]);
    expect(keyFlags(hunting, null)).toEqual([]);
  });

  it('pops the map card once, when a village I win starts its hunt', () => {
    const before = wonView(ME, undefined).communities!.map((c) => ({ ...c, ownerUserId: null }));
    const after = wonView(ME, { state: 'hunt', keyTile: { q: 0, r: 0 } }).communities!;
    expect(newMaps(before, after, ME).map((c) => c.id)).toEqual([after[0]!.id]);
    // Not again, not on a first look (a reload), not someone else's.
    expect(newMaps(after, after, ME)).toEqual([]);
    expect(newMaps(null, after, ME)).toEqual([]);
    expect(newMaps(before, after, userId(2))).toEqual([]);
  });

  it("fits the explore header's title with the longest village name (16 letters)", () => {
    expect(KEY_TEXT.title('Bramble Glenwood').length).toBeLessThanOrEqual(30);
  });

  it('keeps the candle on the same line as "cellar"', () => {
    expect(KEY_TEXT.title('Bramble Glen')).toBe("Bramble Glen's cellar\u00a0🕯️");
  });
});
