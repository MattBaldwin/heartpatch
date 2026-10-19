import { describe, expect, it } from 'vitest';
import type { ReachTile } from '../territory/reach.js';
import { communityReach } from './reach.js';

const ME = 'me';
const tile = (
  q: number,
  r: number,
  ownerUserId: string | null = null,
  homeSlot: number | null = null,
) => ({ q, r, ownerUserId, homeSlot }) satisfies ReachTile;

// My home at (0,0) and its ring, my land out to (3,0), and (6,0) mine but
// cut off by a rival at (5,0) (as in territory's reach tests).
const TILES: ReachTile[] = [
  tile(0, 0, ME, 0),
  tile(1, 0, ME, 0),
  tile(1, -1, ME, 0),
  tile(0, -1, ME, 0),
  tile(-1, 0, ME, 0),
  tile(-1, 1, ME, 0),
  tile(0, 1, ME, 0),
  tile(2, 0, ME),
  tile(3, 0, ME),
  tile(5, 0, 'rival'),
  tile(6, 0, ME),
];

describe('communityReach (#306)', () => {
  it('is touching when a village tile neighbours my land joined to home', () => {
    expect(
      communityReach(
        [
          { q: 4, r: -1 },
          { q: 4, r: 0 },
        ],
        TILES,
        ME,
      ),
    ).toEqual({
      reach: 'touching',
      distance: null,
    });
  });

  it('is away, at steps from my nearest owned tile, when nothing touches', () => {
    // (0,5) is 4 steps from home's (0,1).
    expect(
      communityReach(
        [
          { q: 0, r: 5 },
          { q: 0, r: 6 },
        ],
        TILES,
        ME,
      ),
    ).toEqual({
      reach: 'away',
      distance: 4,
    });
  });

  it('counts cut-off land for the distance, but not for touching', () => {
    expect(communityReach([{ q: 7, r: 0 }], TILES, ME)).toEqual({ reach: 'away', distance: 1 });
  });

  it('is null for a player with no land here', () => {
    expect(communityReach([{ q: 4, r: 0 }], TILES, 'stranger')).toEqual({
      reach: null,
      distance: null,
    });
  });
});
