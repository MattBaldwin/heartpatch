import {
  findAvoidedWords,
  hexKey,
  hexNeighbors,
  isLakeTerrain,
  type HexKey,
  type MapView,
  type PublicBuilding,
  type PublicTile,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { isWaterTile } from '../map/map-dressing.js';
import { testWildIsle, userId } from '../map/test-view.js';
import {
  bridgeCards,
  bridgesOf,
  dockCards,
  docksOf,
  ferryReach,
  hasDock,
  nearestFarShore,
  TRAVEL_TEXT,
} from './travel-model.js';

const ME = userId(1);
const base = testWildIsle();
const building = (buildingId: string): PublicBuilding => ({
  id: '0190a8c4-0000-7000-8000-0000000000b1',
  buildingId,
  kind: 'travel',
  level: 1,
  spot: 1,
  lit: null,
  safeRadius: null,
});

/** The view with `change` applied to the tile at `at`. */
function with_(view: MapView, at: PublicTile, change: Partial<PublicTile>): MapView {
  return {
    ...view,
    tiles: view.tiles.map((t) => (hexKey(t) === hexKey(at) ? { ...t, ...change } : t)),
  };
}

const isLand = (h: { q: number; r: number }) => {
  const t = base.tiles.find((x) => hexKey(x) === hexKey(h));
  return t !== undefined && !isWaterTile(t);
};
const tileAt = (view: MapView, at: PublicTile) => view.tiles.find((t) => hexKey(t) === hexKey(at));

// A river tile with land beside it, and that bank as the land my supply line holds.
const bank = base.tiles.find(
  (t) => t.terrain === 'river' && hexNeighbors(t).some((n) => isLand(n)),
);
const land = new Set<HexKey>(
  bank
    ? hexNeighbors(bank)
        .filter((n) => isLand(n))
        .map((n) => hexKey(n))
    : [],
);
// A tile of mine touching a lake.
const shore = base.tiles.find(
  (t) =>
    t.ownerUserId === ME &&
    t.homeSlot === null &&
    hexNeighbors(t).some((n) =>
      isLakeTerrain(base.tiles.find((x) => hexKey(x) === hexKey(n))?.terrain ?? ''),
    ),
);

describe('bridge card (#621 W1-6)', () => {
  it('is offered on a river tile next to my supplied land, ready to build', () => {
    if (!bank) throw new Error('no river bank');
    const [card, ...rest] = bridgeCards({ tile: bank, view: base, me: ME, supplied: land });
    expect(rest).toEqual([]);
    expect(card).toMatchObject({ id: 'bridge', blocked: null, area: 'spot' });
    expect(card?.cost).toEqual({ timber: 30, stone: 20 });
  });

  it('is blocked, with why, when the river is far from my supplied land', () => {
    if (!bank) throw new Error('no river bank');
    const [card] = bridgeCards({ tile: bank, view: base, me: ME, supplied: new Set() });
    expect(card?.blocked).toBe(TRAVEL_TEXT.problems['too-far']);
    // The sheet's top line says it can't go here, not that it goes across.
    expect(card?.hint).toBe(TRAVEL_TEXT.bridgeBlockedHint);
  });

  it('is not offered once a bridge stands there (nothing left to build)', () => {
    if (!bank) throw new Error('no river bank');
    const view = with_(base, bank, { buildings: [building('bridge')] });
    expect(bridgeCards({ tile: tileAt(view, bank) ?? bank, view, me: ME, supplied: land })).toEqual(
      [],
    );
  });

  it('is not shown on land, a lake, or a Cozy Patch', () => {
    const lake = base.tiles.find((t) => t.terrain === 'wild-lake');
    const mineTile = base.tiles.find((t) => t.ownerUserId === ME && t.homeSlot === null);
    if (!lake || !mineTile) throw new Error('no tile');
    expect(bridgeCards({ tile: lake, view: base, me: ME, supplied: land })).toEqual([]);
    expect(bridgeCards({ tile: mineTile, view: base, me: ME, supplied: land })).toEqual([]);
    const cozy = { ...base, map: { ...base.map, patchType: 'cozy' as const } };
    if (bank) expect(bridgeCards({ tile: bank, view: cozy, me: ME, supplied: land })).toEqual([]);
  });
});

describe('ferry dock card and reach (#621 W1-6)', () => {
  it('is offered on my land next to a lake', () => {
    if (!shore) throw new Error('no shore tile');
    const [card, ...rest] = dockCards({ tile: shore, view: base, me: ME, supplied: land });
    expect(rest).toEqual([]);
    expect(card).toMatchObject({ id: 'ferry-dock', blocked: null });
    expect(card?.cost).toEqual({ timber: 40, stone: 10 });
  });

  it('is not shown away from a lake, on home tiles, or on a rival tile', () => {
    const inland = base.tiles.find(
      (t) =>
        t.ownerUserId === ME &&
        t.homeSlot === null &&
        !hexNeighbors(t).some((n) =>
          isLakeTerrain(base.tiles.find((x) => hexKey(x) === hexKey(n))?.terrain ?? ''),
        ),
    );
    const home = base.tiles.find((t) => t.ownerUserId === ME && t.homeSlot !== null);
    const rival = base.tiles.find((t) => t.ownerUserId === userId(2));
    if (!inland || !home || !rival) throw new Error('no tile');
    for (const tile of [inland, home, rival]) {
      expect(dockCards({ tile, view: base, me: ME, supplied: land })).toEqual([]);
    }
  });

  it('knows my docks and bridges, and the far shore the ferry reaches', () => {
    if (!shore || !bank) throw new Error('no tile');
    const view = with_(with_(base, shore, { buildings: [building('ferry-dock')] }), bank, {
      buildings: [building('bridge')],
    });
    expect(docksOf(view.tiles)).toEqual([{ q: shore.q, r: shore.r, ownerUserId: ME }]);
    expect(bridgesOf(view.tiles)).toEqual([{ q: bank.q, r: bank.r, ownerUserId: '' }]);
    const dockTile = tileAt(view, shore);
    expect(dockTile && hasDock(dockTile, ME)).toBe(true);
    expect(dockTile && hasDock(dockTile, userId(2))).toBe(false);
    const reach = ferryReach(view, shore);
    expect(reach.size).toBeGreaterThan(0);
    expect(reach.has(hexKey(shore))).toBe(false);
  });

  it('pans to the nearest tile of the far shore, not land already joined to home', () => {
    const dock = { q: 0, r: 0 };
    const near = hexKey({ q: 1, r: 0 });
    const far = hexKey({ q: 3, r: 0 });
    const reach = new Map([
      [near, 1],
      [far, 2],
    ]);
    expect(nearestFarShore(reach, dock, new Set([near]))).toEqual({ q: 3, r: 0 });
    // All joined already: the nearest of them.
    expect(nearestFarShore(reach, dock, new Set([near, far]))).toEqual({ q: 1, r: 0 });
    expect(nearestFarShore(new Map(), dock, null)).toBeNull();
  });

  it('keeps the words kind', () => {
    const lines = [
      ...Object.values(TRAVEL_TEXT.problems),
      TRAVEL_TEXT.bridgeBuilt,
      TRAVEL_TEXT.dockBuilt,
      TRAVEL_TEXT.ferryAcross,
      TRAVEL_TEXT.ferryReach,
      TRAVEL_TEXT.ferryNowhere,
      TRAVEL_TEXT.bridgeEffect,
      TRAVEL_TEXT.dockEffect,
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
  });
});
