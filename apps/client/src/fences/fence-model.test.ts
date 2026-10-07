import { edgeNeighbor, findAvoidedWords, hexKey, type PublicFence } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import {
  canAfford,
  crackedBy,
  edgeName,
  fenceCard,
  fenceChoices,
  fenceCrackers,
  FENCE_TEXT,
  FENCES,
  isInterior,
  openEdges,
} from './fence-model.js';

const ME = userId(1);
const fence = (extra: Partial<PublicFence> = {}): PublicFence => ({
  id: '0190a8c4-0000-7000-8000-000000000501',
  edge: 0,
  buildingId: 'emberwood-palisade',
  level: 1,
  hp: 70,
  maxHp: 70,
  ...extra,
});

describe('the fence sheet (#203)', () => {
  it('offers all eight fences, one per element', () => {
    expect(FENCES).toHaveLength(8);
    expect(new Set(FENCES.map((f) => f.element)).size).toBe(8);
  });

  it('says which elements crack each fence, from the element table', () => {
    // Fire and Frost hit Leaf hard (design doc §5).
    expect(fenceCrackers('leaf')).toEqual(['Fire', 'Frost']);
    expect(crackedBy('leaf')).toBe('Fire and Frost crack it');
    expect(crackedBy('fire')).toBe('Water and Stone crack it');
    for (const f of FENCES) expect(fenceCrackers(f.element).length).toBeGreaterThan(0);
  });

  it('names edges the way the map lays them out', () => {
    expect([0, 1, 2, 3, 4, 5].map(edgeName)).toEqual([
      'east',
      'north-east',
      'north-west',
      'west',
      'south-west',
      'south-east',
    ]);
  });

  it('finds the open edges of my land: facing other land, with no fence', () => {
    const view = testView(1);
    const mine = view.tiles.filter((t) => t.ownerUserId === ME);
    const owned = new Set(mine.map(hexKey));
    // A home-ring tile on the rim: some edges face wild land.
    const rim = mine.find((t) =>
      [0, 1, 2, 3, 4, 5].some((e) => !owned.has(hexKey(edgeNeighbor(t, e as 0)))),
    );
    expect(rim).toBeDefined();
    if (!rim) return;
    const open = openEdges(rim, view, ME);
    expect(open.length).toBeGreaterThan(0);
    for (const e of open) expect(owned.has(hexKey(edgeNeighbor(rim, e as 0)))).toBe(false);
    // Fence one of them: it isn't open any more.
    const first = open[0] ?? 0;
    const fenced = { ...rim, fences: [fence({ edge: first })] };
    expect(openEdges(fenced, view, ME)).toEqual(open.filter((e) => e !== first));
    expect(isInterior(fenced, first, view, ME)).toBe(false);
    // An edge between two of my tiles is inside my land.
    const inner = [0, 1, 2, 3, 4, 5].find((e) => owned.has(hexKey(edgeNeighbor(rim, e as 0))));
    if (inner !== undefined) expect(isInterior(rim, inner, view, ME)).toBe(true);
  });

  it('prices a card: repair when damaged, upgrade with before and after, half back', () => {
    const full = fenceCard(fence());
    expect(full?.repair).toBeNull();
    expect(full?.percent).toBe(100);
    expect(full?.upgrade).toEqual({ cost: { emberwood: 8, timber: 4 }, hp: 100, maxHp: 100 });
    // Half back, rounded down: 6 Emberwood and 2 Timber.
    expect(full?.refund).toEqual({ emberwood: 3, timber: 1 });

    const bumped = fenceCard(fence({ hp: 42 }));
    expect(bumped?.percent).toBe(60);
    expect(bumped?.repair).not.toBeNull();
    // An upgrade isn't a free repair: it keeps what it lost.
    expect(bumped?.upgrade?.hp).toBe(72);

    const top = fenceCard(fence({ level: 3, hp: 140, maxHp: 140 }));
    expect(top?.upgrade).toBeNull();
    expect(fenceCard(fence({ buildingId: 'not-a-fence' }))).toBeNull();
  });

  it('multiplies the build cost by the edges picked, and checks the bag', () => {
    const one = fenceChoices({}, 1).find((c) => c.fence.id === 'emberwood-palisade');
    const two = fenceChoices({ emberwood: 12, timber: 4 }, 2).find(
      (c) => c.fence.id === 'emberwood-palisade',
    );
    expect(one?.cost).toEqual({ emberwood: 6, timber: 2 });
    expect(one?.affordable).toBe(false);
    expect(two?.cost).toEqual({ emberwood: 12, timber: 4 });
    expect(two?.affordable).toBe(true);
    expect(canAfford({ emberwood: 5 }, { emberwood: 6 })).toBe(false);
  });

  it('stays cozy and kid-safe', () => {
    const lines = [
      FENCE_TEXT.fenced,
      FENCE_TEXT.open(1),
      FENCE_TEXT.open(3),
      FENCE_TEXT.inside,
      FENCE_TEXT.build,
      FENCE_TEXT.openSheet(2),
      FENCE_TEXT.fenceThem(1, '6 Emberwood'),
      FENCE_TEXT.fenceThem(2, '12 Emberwood'),
      FENCE_TEXT.fenceThem(4, '24 Emberwood'),
      FENCE_TEXT.needMore,
      FENCE_TEXT.built(2),
      FENCE_TEXT.interiorNote,
      FENCE_TEXT.refund('3 Emberwood and 1 Timber'),
      FENCE_TEXT.takeDownTitle,
      FENCE_TEXT.takenDown('3 Emberwood'),
      FENCE_TEXT.repaired,
      FENCE_TEXT.upgraded(2),
      FENCE_TEXT.innerDown(1),
      FENCE_TEXT.innerDown(3),
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
    expect(FENCE_TEXT.fenceThem(2, 'x')).toBe('🪵 Fence both (x)');
    expect(FENCE_TEXT.items({ emberwood: 3, timber: 1 })).toBe('1 Timber and 3 Emberwood');
    expect(FENCE_TEXT.items({ emberwood: 3, timber: 1, glimmer: 2 })).toBe(
      '1 Timber, 3 Emberwood and 2 Glimmer',
    );
  });
});
