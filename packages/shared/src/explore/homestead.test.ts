import { describe, expect, it } from 'vitest';
import { hex, hexKey, hexSpiral, type Hex } from '../hex/index.js';
import {
  homesteadChanges,
  homesteadStates,
  type HomesteadRow,
  type HomesteadTile,
} from './homestead.js';

const ME = 'me';
const RIVAL = 'rival';

// My home at the origin: the Heart Seed and its ring (homeSlot 0).
const HOME = hexSpiral(hex(0, 0), 1);

/** A map where I own my home plus `mine`, and the rival owns `theirs`. */
function map(mine: Hex[], theirs: Hex[] = []): HomesteadTile[] {
  const tiles = new Map<string, HomesteadTile>();
  for (const h of hexSpiral(hex(0, 0), 5)) {
    tiles.set(hexKey(h), { ...h, ownerUserId: null, homeSlot: null });
  }
  for (const h of HOME) tiles.set(hexKey(h), { ...h, ownerUserId: ME, homeSlot: 0 });
  for (const h of mine) tiles.set(hexKey(h), { ...h, ownerUserId: ME, homeSlot: null });
  for (const h of theirs) tiles.set(hexKey(h), { ...h, ownerUserId: RIVAL, homeSlot: null });
  return [...tiles.values()];
}

function row(h: Hex, over: Partial<HomesteadRow> = {}): HomesteadRow {
  return { ...h, completed: true, joined: false, paused: false, ...over };
}

const states = (tiles: HomesteadTile[], rows: HomesteadRow[]) =>
  Object.fromEntries(homesteadStates(tiles, rows, ME));

// A line of land going east from home: (2,0), (3,0), (4,0).
const A = hex(2, 0);
const B = hex(3, 0);
const C = hex(4, 0);

describe('homesteadStates', () => {
  it('joins a fully explored tile that borders the home ring', () => {
    expect(states(map([A]), [row(A)])).toEqual({ '2,0': 'joined' });
  });

  it('leaves a tile that isn’t fully explored as ordinary land', () => {
    expect(states(map([A]), [row(A, { completed: false })])).toEqual({});
  });

  it('grows outward through other homesteads, as one connected shape', () => {
    expect(states(map([A, B, C]), [row(A), row(B), row(C)])).toEqual({
      '2,0': 'joined',
      '3,0': 'joined',
      '4,0': 'joined',
    });
  });

  it('doesn’t join an explored tile that has never touched home (and never pauses it)', () => {
    // B explored, but A between it and home isn't.
    expect(states(map([A, B]), [row(A, { completed: false }), row(B)])).toEqual({});
  });

  it('pauses a homestead cut off from home by a capture', () => {
    // The rival wins A: B and C were homesteads beyond it.
    const rows = [row(A, { joined: true }), row(B, { joined: true }), row(C, { joined: true })];
    expect(states(map([B, C], [A]), rows)).toEqual({ '3,0': 'paused', '4,0': 'paused' });
  });

  it('joins a won-back homestead again at once, and wakes the ones beyond it', () => {
    const rows = [
      row(A, { joined: true }),
      row(B, { joined: true, paused: true }),
      row(C, { joined: true, paused: true }),
    ];
    expect(states(map([A, B, C]), rows)).toEqual({
      '2,0': 'joined',
      '3,0': 'joined',
      '4,0': 'joined',
    });
  });

  it('only counts the player’s own land and never the home tiles themselves', () => {
    // A row for a tile the rival owns, and one for a home tile.
    const rows = [row(A), row(hex(1, 0))];
    expect(states(map([], [A]), rows)).toEqual({});
  });

  it('gives a player without a home no homesteads', () => {
    const tiles = map([A]).map((t) => ({
      ...t,
      ownerUserId: t.homeSlot === null ? t.ownerUserId : null,
    }));
    expect(states(tiles, [row(A, { joined: true })])).toEqual({ '2,0': 'paused' });
    expect(states(tiles, [row(A)])).toEqual({});
  });
});

describe('homesteadChanges', () => {
  it('lists new homesteads, newly cut-off ones and reconnected ones', () => {
    const rows = [
      row(A),
      row(B, { joined: true }),
      row(C, { joined: true, paused: true }),
      row(hex(2, -1), { joined: true }),
    ];
    const now = new Map([
      [hexKey(A), 'joined'],
      [hexKey(B), 'paused'],
      [hexKey(C), 'joined'],
      [hexKey(hex(2, -1)), 'joined'],
    ] as const);
    expect(homesteadChanges(rows, now)).toEqual({
      joined: [A],
      paused: [B],
      resumed: [C],
    });
  });

  it('changes nothing when a homestead simply changes hands', () => {
    // Captured: it's no longer the player's, so it has no state at all.
    expect(homesteadChanges([row(A, { joined: true })], new Map())).toEqual({
      joined: [],
      paused: [],
      resumed: [],
    });
  });
});
