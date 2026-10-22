import { hexKey, hexNeighbors, type CommunityView, type MapView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import {
  bagMaps,
  glintLine,
  KEY_TEXT,
  keyGlows,
  keyHuntOn,
  keyMaps,
  newMaps,
} from './key-hunt-view.js';

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
  it("shows the key's block on its tile to its winner, and what to do to find it", () => {
    const base = wonView(ME, undefined);
    const key = farTile(base);
    const view = wonView(ME, { state: 'hunt', keyTile: { q: key.q, r: key.r } });
    const wild = keyHuntOn(view, key, ME);
    expect(wild).toMatchObject({ kind: 'key', land: 'wild' });
    expect(wild?.community.id).toBe(view.communities![0]!.id);

    const owned = (owner: string): MapView => ({
      ...view,
      tiles: view.tiles.map((t) =>
        t.q === key.q && t.r === key.r ? { ...t, ownerUserId: owner } : t,
      ),
    });
    // Next to my land isn't enough (owner decision 2026-10-22): a rival's tile is won first.
    const beside = hexNeighbors(key)[0]!;
    const near: MapView = {
      ...owned(userId(2)),
      tiles: owned(userId(2)).tiles.map((t) =>
        t.q === beside.q && t.r === beside.r ? { ...t, ownerUserId: ME } : t,
      ),
    };
    const theirs = near.tiles.find((t) => t.q === key.q && t.r === key.r)!;
    expect(keyHuntOn(near, theirs, ME)).toMatchObject({ kind: 'key', land: 'theirs' });
    const mine = owned(ME);
    expect(
      keyHuntOn(
        mine,
        mine.tiles.find((t) => t.q === key.q && t.r === key.r)!,
        ME,
      ),
    ).toMatchObject({
      kind: 'key',
      land: 'mine',
    });
    // No challenges on this patch: the key stayed (no wild land near), so land next to it finds it.
    const off = (v: MapView): MapView => ({ ...v, map: { ...v.map, pvpMode: 'off' } });
    expect(keyHuntOn(off(near), theirs, ME)).toMatchObject({ kind: 'key', land: 'next' });
    const far = owned(userId(2));
    const lone = far.tiles.find((t) => t.q === key.q && t.r === key.r)!;
    expect(keyHuntOn(off(far), lone, ME)).toMatchObject({ kind: 'key', land: 'near' });
    // Nothing next to it left to claim: it waits, softly.
    const ring = new Set(hexNeighbors(key).map(hexKey));
    const full: MapView = {
      ...far,
      tiles: far.tiles.map((t) => (ring.has(hexKey(t)) ? { ...t, ownerUserId: userId(2) } : t)),
    };
    const waits = full.tiles.find((t) => t.q === key.q && t.r === key.r)!;
    expect(keyHuntOn(off(full), waits, ME)).toMatchObject({ kind: 'key', land: 'taken' });
    // Nobody else sees it (their view never has `cellar`, but even so).
    expect(keyHuntOn(near, theirs, userId(2))).toBeNull();
  });

  it('says what to do next on the key tile, by whose land it is', () => {
    expect(glintLine('mine')).toBe(KEY_TEXT.glintMine);
    expect(glintLine('wild')).toContain('Claim');
    expect(glintLine('theirs')).toContain('Challenge');
    expect(glintLine('next')).toContain('next to it');
    expect(glintLine('near')).toContain('Claim land next to it');
    expect(glintLine('taken')).toBe(
      'Something glints here… the land around it is all taken for now. 🌙',
    );
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

  it('glows the key, and keeps its map in the bag, only while I hunt for it', () => {
    const key = { q: 0, r: 0 };
    const hunting = wonView(ME, { state: 'hunt', keyTile: key });
    expect(keyGlows(hunting, ME)).toEqual([key]);
    expect(keyMaps(hunting, ME)).toEqual([{ community: hunting.communities![0], keyTile: key }]);
    for (const view of [wonView(ME, { state: 'key' }), wonView(ME, { state: 'open' })]) {
      expect(keyGlows(view, ME)).toEqual([]);
      expect(keyMaps(view, ME)).toEqual([]);
    }
    expect(keyGlows(hunting, null)).toEqual([]);
    expect(keyGlows(hunting, userId(2))).toEqual([]);
  });

  it("names the bag's map after the Hollow, and follows its new name", () => {
    const hunting = wonView(ME, { state: 'hunt', keyTile: { q: 0, r: 0 } });
    const first = hunting.communities![0]!;
    expect(bagMaps(hunting, ME)).toEqual([{ id: first.id, line: KEY_TEXT.bagLine(first.name) }]);
    const named: MapView = {
      ...hunting,
      communities: [{ ...first, name: 'Bramble Glen' }, ...hunting.communities!.slice(1)],
    };
    expect(bagMaps(named, ME)[0]?.line).toBe("Bramble Glen's cellar key");
    expect(bagMaps(wonView(ME, { state: 'key' }), ME)).toEqual([]);
  });

  it('keeps every player line free of "village" and "community" (style guide)', () => {
    const lines = Object.values(KEY_TEXT).map((v) =>
      typeof v === 'function' ? v('Bramble Glen') : v,
    );
    for (const line of lines) expect(line).not.toMatch(/village|community/i);
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
});
