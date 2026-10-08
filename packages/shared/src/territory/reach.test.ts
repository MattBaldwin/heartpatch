import { describe, expect, it } from 'vitest';
import { hexKey } from '../hex/index.js';
import { connectedLand, isTradingPost, postReach, type ReachTile } from './reach.js';

const ME = 'me';
const tile = (
  q: number,
  r: number,
  ownerUserId: string | null = null,
  homeSlot: number | null = null,
) => ({ q, r, ownerUserId, homeSlot }) satisfies ReachTile;

// My home: the Heart Seed at (0,0) and its ring. Claimed land runs east to
// (2,0) and (3,0); (5,0) is mine too but cut off (a rival holds (4,0)).
const HOME = [
  tile(0, 0, ME, 0),
  tile(1, 0, ME, 0),
  tile(1, -1, ME, 0),
  tile(0, -1, ME, 0),
  tile(-1, 0, ME, 0),
  tile(-1, 1, ME, 0),
  tile(0, 1, ME, 0),
];
const TILES: ReachTile[] = [
  ...HOME,
  tile(2, 0, ME),
  tile(3, 0, ME),
  tile(4, 0, 'rival'),
  tile(5, 0, ME),
  tile(6, 0),
  tile(0, 4),
];

describe('connectedLand', () => {
  it('is my land joined to home through my own tiles', () => {
    const joined = connectedLand(TILES, ME);
    expect(joined.has(hexKey(tile(3, 0)))).toBe(true);
    expect(joined.has(hexKey(tile(5, 0)))).toBe(false); // cut off
    expect(joined.size).toBe(9);
  });

  it('is empty for a player with no home here', () => {
    expect(connectedLand(TILES, 'stranger').size).toBe(0);
  });
});

describe('postReach (owner decisions 1–3 on #30)', () => {
  it('is connected when my land joined to home touches the post', () => {
    expect(postReach({ q: 3, r: 1 }, TILES, ME)).toEqual({ kind: 'connected' });
  });

  it('is a journey by distance to my nearest land when it isn’t', () => {
    // (0,4) is 3 steps from my ring tile (0,1).
    expect(postReach({ q: 0, r: 4 }, TILES, ME)).toEqual({ kind: 'journey', distance: 3 });
  });

  it('counts cut-off land for distance, but not for connection', () => {
    // (6,0) touches my cut-off (5,0): a journey of 1, not connected.
    expect(postReach({ q: 6, r: 0 }, TILES, ME)).toEqual({ kind: 'journey', distance: 1 });
  });

  it('is null for someone with no land', () => {
    expect(postReach({ q: 0, r: 4 }, TILES, 'stranger')).toBeNull();
  });
});

describe('isTradingPost', () => {
  it('reads the terrain', () => {
    expect(isTradingPost({ terrain: 'trading-post' })).toBe(true);
    expect(isTradingPost({ terrain: 'meadow' })).toBe(false);
  });
});
