import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { MAP_GEN } from '../data/map-gen.js';
import { findAvoidedWords } from '../data/avoided-words.js';
import { firstHomeTiles, heartSeedOf } from '../hollow/index.js';
import {
  pieceCost,
  restoredNameIdeas,
  restoreProblem,
  ringToPlant,
  villageRing,
  villageWinner,
  type RingTile,
} from './restore.js';

describe('pieceCost (#306 PR 3)', () => {
  it("is the terrain's resources plus one Heartdust, from data", () => {
    expect(pieceCost('meadow', COMMUNITY_RULES)).toEqual({ timber: 6, stone: 4, heartdust: 1 });
    expect(pieceCost('hills', COMMUNITY_RULES)).toEqual({ timber: 4, stone: 6, heartdust: 1 });
    // A terrain without its own row pays the default.
    expect(pieceCost('swamp', COMMUNITY_RULES)).toEqual(
      pieceCost('no-such-terrain', COMMUNITY_RULES),
    );
    expect(pieceCost('meadow', COMMUNITY_RULES)[COMMUNITY_RULES.joyResource]).toBe(
      COMMUNITY_RULES.heartdustPerPiece,
    );
  });
});

describe('villageWinner (#306 PR 3)', () => {
  const t = (restored: boolean, ownerUserId: string | null) => ({ restored, ownerUserId });
  it('is the one Keeper who restored and holds every tile', () => {
    expect(villageWinner([t(true, 'a'), t(true, 'a'), t(true, 'a')])).toBe('a');
  });
  it('is nobody while a tile is grey, wild, or held by someone else', () => {
    expect(villageWinner([t(true, 'a'), t(false, null)])).toBeNull();
    expect(villageWinner([t(true, 'a'), t(true, null)])).toBeNull();
    expect(villageWinner([t(true, 'a'), t(true, 'b')])).toBeNull();
    expect(villageWinner([])).toBeNull();
  });
});

describe('ringToPlant (#306 PR 3)', () => {
  const square = { q: 4, r: 0 };
  const tile = (q: number, r: number, over: Partial<RingTile> = {}): RingTile => ({
    q,
    r,
    ownerUserId: 'me',
    homeSlot: null,
    terrain: 'meadow',
    communityId: 'v',
    ...over,
  });
  it('plants the square and its six neighbours when they are mine or wild', () => {
    const ring = villageRing(square).map((h, i) =>
      tile(h.q, h.r, i > 4 ? { ownerUserId: null, communityId: null } : {}),
    );
    expect(ringToPlant(square, ring, 'me', 'v')).toHaveLength(7);
  });
  it("leaves someone else's land, posts, other homes and other villages alone", () => {
    const [s, a, b, c, d, e, f] = villageRing(square);
    const ring = [
      tile(s!.q, s!.r),
      tile(a!.q, a!.r, { ownerUserId: 'rival', communityId: null }),
      tile(b!.q, b!.r, { terrain: 'trading-post', ownerUserId: null, communityId: null }),
      tile(c!.q, c!.r, { homeSlot: 2, ownerUserId: 'rival', communityId: null }),
      tile(d!.q, d!.r, { communityId: 'other', ownerUserId: null }),
      tile(e!.q, e!.r),
      // f is off the map.
    ];
    expect(ringToPlant(square, ring, 'me', 'v').map((h) => [h.q, h.r])).toEqual([
      [s!.q, s!.r],
      [e!.q, e!.r],
    ]);
    expect(f).toBeDefined();
  });
  it("keeps a village ring's middle as its own Heart Seed", () => {
    expect(heartSeedOf(villageRing(square))).toEqual(square);
  });
});

describe('restoredNameIdeas (#306 PR 3)', () => {
  it('swaps the generated ending for three restored ones that fit the 16-letter cap', () => {
    expect(restoredNameIdeas('Bramble Hollow', COMMUNITY_RULES, MAP_GEN.communities)).toEqual([
      'Bramble Glen',
      'Bramble Meadow',
      'Bramble Hearth',
    ]);
    expect(restoredNameIdeas('Bramble Glen', COMMUNITY_RULES, MAP_GEN.communities)).toEqual(
      restoredNameIdeas('Bramble Hollow', COMMUNITY_RULES, MAP_GEN.communities),
    );
    for (const stem of MAP_GEN.communities.nameStems) {
      const ideas = restoredNameIdeas(
        `${stem} ${MAP_GEN.communities.nameSuffix}`,
        COMMUNITY_RULES,
        MAP_GEN.communities,
      );
      expect(ideas).toHaveLength(3);
      for (const idea of ideas) {
        expect(idea.length).toBeLessThanOrEqual(16);
        expect(findAvoidedWords(idea)).toEqual([]);
      }
    }
  });
});

describe('restoreProblem (#306 PR 3)', () => {
  const ok = { won: false, piecesDone: 1, piecesNeeded: 4, open: true, reach: 'touching' } as const;
  it('opens by day when my land touches the village', () => {
    expect(restoreProblem(ok)).toBeNull();
  });
  it('says why, in order', () => {
    expect(restoreProblem({ ...ok, won: true })).toBe('won');
    expect(restoreProblem({ ...ok, piecesDone: 4 })).toBe('restored');
    expect(restoreProblem({ ...ok, open: false })).toBe('night');
    expect(restoreProblem({ ...ok, reach: 'away' })).toBe('away');
    expect(restoreProblem({ ...ok, reach: null })).toBe('away');
  });
});

describe('firstHomeTiles (#306 PR 3)', () => {
  it('gives a Keeper with two rings one Heart Seed', () => {
    const ring = (seed: { q: number; r: number }, communityId: string | null) =>
      villageRing(seed).map((h) => ({ ...h, homeSlot: 2, communityId }));
    const both = [...ring({ q: 0, r: 0 }, null), ...ring({ q: 4, r: -2 }, 'village')];
    // Every tile of both: the middle of the two, a tile that isn't a seed at all.
    expect(heartSeedOf(both)).toEqual({ q: 2, r: -1 });
    expect(heartSeedOf(firstHomeTiles(both))).toEqual({ q: 0, r: 0 });
    // Wild land and a village's grey tiles are no one's home.
    expect(firstHomeTiles([{ q: 9, r: 9, homeSlot: null, communityId: null }])).toEqual([]);
  });
});
