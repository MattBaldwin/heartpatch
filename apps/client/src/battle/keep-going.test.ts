import {
  findAvoidedWords,
  hexKey,
  hexNeighbors,
  type MapView,
  type PlayerBattle,
  type PublicFence,
  type PublicTile,
  type TerritoryStatus,
} from '@heartpatch/shared';
import { describe, expect, it, vi } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import { ApiRequestError } from '../net/api.js';
import { brokenTileOf, keepGoing, KEEP_GOING_TEXT, type KeepGoingApi } from './keep-going.js';

const ME = userId(1);
const RIVAL = userId(2);
const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const ENDED = new Date(NOW - 60_000).toISOString();
const UNTIL = new Date(NOW - 60_000 + 10 * 60_000).toISOString();

const status = (fenceBroken: TerritoryStatus['fenceBroken']): TerritoryStatus =>
  ({ now: new Date(NOW).toISOString(), fenceBroken }) as TerritoryStatus;

const fence = (edge: number): PublicFence => ({
  id: `0190a8c4-0000-7000-8000-00000000060${String(edge)}`,
  edge,
  buildingId: 'hedge',
  level: 1,
  hp: 0,
  maxHp: 70,
});

/** A rival's tile next to my land, with its fence gone (or, `fenced`, built up again). */
function setup(fenced = false, owner: string | null = RIVAL) {
  const base = testView(2);
  const mine = new Set(base.tiles.filter((t) => t.ownerUserId === ME).map(hexKey));
  const edge = base.tiles.find(
    (t) =>
      t.ownerUserId === null &&
      t.homeSlot === null &&
      hexNeighbors(t).some((n) => mine.has(hexKey(n))),
  )!;
  const fixed: PublicTile = {
    ...edge,
    ownerUserId: owner,
    fences: fenced ? [0, 1, 2, 3, 4, 5].map((e) => fence(e)) : [],
  };
  const view: MapView = { ...base, tiles: base.tiles.map((t) => (t === edge ? fixed : t)) };
  return { view, tile: fixed };
}

const battle = { id: 'b1', mapId: 'm1', endedAt: ENDED } as PlayerBattle;
const guard = { id: 'b2', mapId: 'm1', kind: 'rival-tile' } as PlayerBattle;
const send = { newKey: () => 'key-1', wait: () => Promise.resolve(), retryAfterMs: 0 };

function apiFor(
  view: MapView,
  tile: PublicTile,
  st = status([{ q: tile.q, r: tile.r, until: UNTIL }]),
) {
  const attack = vi.fn<KeepGoingApi['attack']>(() => Promise.resolve(guard));
  const api: KeepGoingApi = {
    status: () => Promise.resolve(st),
    view: () => Promise.resolve(view),
    attack,
  };
  return { api, attack };
}

describe('finding the tile whose fence broke (#527)', () => {
  it('takes the open window that ends when this battle’s window does', () => {
    const st = status([
      { q: 1, r: 1, until: new Date(NOW + 4 * 60_000).toISOString() },
      { q: 2, r: 2, until: UNTIL },
    ]);
    expect(brokenTileOf(st, ENDED)).toEqual({ q: 2, r: 2 });
  });

  it('skips a window that is over, and says none when nothing is open', () => {
    const over = status([{ q: 3, r: 3, until: new Date(NOW - 1000).toISOString() }]);
    expect(brokenTileOf(over, ENDED)).toBeNull();
    expect(brokenTileOf(status(undefined), ENDED)).toBeNull();
  });
});

describe('Keep going from the result card (#527)', () => {
  it('sends the same attack the land panel sends, with an idempotency key', async () => {
    const { view, tile } = setup();
    const { api, attack } = apiFor(view, tile);
    const out = await keepGoing(api, send, battle, ME, () => true);
    expect(out).toEqual({ kind: 'battle', battle: guard });
    expect(attack).toHaveBeenCalledWith('m1', { q: tile.q, r: tile.r }, 'key-1');
  });

  it('says so, and sends nothing, when the window is over', async () => {
    const { view, tile } = setup();
    const { api, attack } = apiFor(view, tile, status([]));
    expect(await keepGoing(api, send, battle, ME, () => true)).toEqual({
      kind: 'say',
      text: KEEP_GOING_TEXT.passed,
    });
    expect(attack).not.toHaveBeenCalled();
  });

  it('says so when the land went wild meanwhile', async () => {
    const { view, tile } = setup(false, null);
    const { api, attack } = apiFor(view, tile);
    expect(await keepGoing(api, send, battle, ME, () => true)).toEqual({
      kind: 'say',
      text: KEEP_GOING_TEXT.passed,
    });
    expect(attack).not.toHaveBeenCalled();
  });

  it('does not spend a try on a gap the owner built up again', async () => {
    const { view, tile } = setup(true);
    const { api, attack } = apiFor(view, tile);
    expect(await keepGoing(api, send, battle, ME, () => true)).toEqual({
      kind: 'say',
      text: KEEP_GOING_TEXT.rebuilt,
    });
    expect(attack).not.toHaveBeenCalled();
  });

  it('shows the server’s own words when it says no (tired squishies, a rule)', async () => {
    const { view, tile } = setup();
    const { api, attack } = apiFor(view, tile);
    attack.mockRejectedValue(new ApiRequestError('CONFLICT', 'Your squishies need a rest first!'));
    expect(await keepGoing(api, send, battle, ME, () => true)).toEqual({
      kind: 'say',
      text: 'Your squishies need a rest first!',
    });
  });

  it('says something kind when the request fails some other way', async () => {
    const { view, tile } = setup();
    const { api, attack } = apiFor(view, tile);
    attack.mockRejectedValue(new Error('boom: stack trace'));
    const out = await keepGoing(api, send, battle, ME, () => true);
    expect(out.kind).toBe('say');
    if (out.kind === 'say') expect(out.text).not.toMatch(/boom|stack/);
  });

  it('drops the answer once the player moved on', async () => {
    const { view, tile } = setup();
    const { api, attack } = apiFor(view, tile);
    expect(await keepGoing(api, send, battle, ME, () => false)).toEqual({ kind: 'gone' });
    expect(attack).not.toHaveBeenCalled();
  });

  it('uses no avoided words', () => {
    for (const text of Object.values(KEEP_GOING_TEXT)) expect(findAvoidedWords(text)).toEqual([]);
  });
});
