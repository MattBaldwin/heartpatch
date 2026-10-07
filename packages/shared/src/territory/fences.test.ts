import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { ELEMENTS } from '../data/elements.js';
import { FENCE_RULES } from '../data/fences.js';
import { hex, hexNeighbors, type Hex } from '../hex/index.js';
import { BattleFenceSetupSchema } from '../schemas/battle.js';
import { FenceRulesSchema } from '../schemas/data/fences.js';
import type { FenceBuilding } from '../schemas/data/buildings.js';
import {
  borderEdges,
  edgeNeighbor,
  exposedSegments,
  fenceBattleSetup,
  fenceHpAfterUpgrade,
  fencePercent,
  fenceRepairCost,
  fenceStats,
  isTileFenced,
  oppositeEdge,
  weakestSegment,
  HEX_EDGES,
  type FenceSpot,
} from './fences.js';

const FENCES = BUILDINGS.filter((b): b is FenceBuilding => b.kind === 'fence');
const wood = FENCES.find((f) => f.id === 'emberwood-palisade')!;

/** Every edge of `tile` fenced, except `skip`. */
const ring = (tile: Hex, skip: number[] = []): FenceSpot[] =>
  HEX_EDGES.filter((e) => !skip.includes(e)).map((edge) => ({ ...tile, edge }));

// A little patch: a centre tile and its ring, all mine.
const centre = hex(0, 0);
const patch = [centre, ...hexNeighbors(centre)];
const east = hex(1, 0); // edge 0 of the centre

describe('fence edges (#203, #204)', () => {
  it('numbers edges in HEX_DIRECTIONS order, and each edge has an opposite', () => {
    expect(edgeNeighbor(centre, 0)).toEqual(hex(1, 0));
    expect(edgeNeighbor(centre, 2)).toEqual(hex(0, -1));
    for (const edge of HEX_EDGES) {
      const back = edgeNeighbor(edgeNeighbor(centre, edge), oppositeEdge(edge));
      expect(back).toEqual(centre);
    }
  });

  it('a tile’s border edges are the ones facing land its owner doesn’t hold', () => {
    expect(borderEdges(centre, patch)).toEqual([]);
    // East's edges 2, 3 and 4 face (1,-1), the centre and (0,1): all mine.
    expect(borderEdges(east, patch)).toEqual([0, 1, 5]);
  });
});

describe('isTileFenced (#204: every edge touching land you don’t own has a segment)', () => {
  it('an interior tile needs no fence at all', () => {
    expect(isTileFenced(centre, patch, [])).toBe(true);
  });

  it('a border tile is fenced only when every border edge has a segment', () => {
    const tile = east;
    expect(isTileFenced(tile, patch, [])).toBe(false);
    expect(isTileFenced(tile, patch, ring(tile, [0]))).toBe(false);
    // Interior edges (2, 3 and 4 face my own land) don't matter.
    const borderOnly = [0, 1, 5].map((edge) => ({ ...tile, edge }));
    expect(isTileFenced(tile, patch, borderOnly)).toBe(true);
  });

  it('a neighbour I capture turns its edge interior: fenced with one fewer segment', () => {
    const tile = east;
    const segments = [1, 5].map((edge) => ({ ...tile, edge })); // edge 0 open
    expect(isTileFenced(tile, patch, segments)).toBe(false);
    const captured = [...patch, edgeNeighbor(tile, 0)];
    expect(isTileFenced(tile, captured, segments)).toBe(true);
  });

  it('a neighbour I lose opens its edge: no longer fenced until I build there', () => {
    const tile = east;
    const segments = [0, 1, 5].map((edge) => ({ ...tile, edge }));
    expect(isTileFenced(tile, patch, segments)).toBe(true);
    // The tile to its south-west, (0,1), goes to a rival: edge 4 now faces them.
    const lost = patch.filter((t) => !(t.q === 0 && t.r === 1));
    expect(isTileFenced(tile, lost, segments)).toBe(false);
    expect(isTileFenced(tile, lost, [...segments, { ...tile, edge: 4 }])).toBe(true);
  });

  it('only the owner’s segments on this tile count, never a neighbour’s side', () => {
    const tile = east;
    // The rival fenced their side of every edge; that doesn't fence my tile.
    const theirs = HEX_EDGES.map((edge) => ({
      ...edgeNeighbor(tile, edge),
      edge: oppositeEdge(edge),
    }));
    expect(isTileFenced(tile, patch, theirs)).toBe(false);
  });

  it('a tile the owner doesn’t hold isn’t fenced', () => {
    expect(isTileFenced(hex(5, 5), patch, ring(hex(5, 5)))).toBe(false);
  });
});

describe('the segment a challenger fights (owner decision 2026-10-06)', () => {
  const tile = east;
  const segments = [
    { ...tile, edge: 0, hp: 70 },
    { ...tile, edge: 1, hp: 40 },
    { ...tile, edge: 5, hp: 40 },
  ];

  it('is one between the challenger’s land and the tile', () => {
    const challenger = [edgeNeighbor(tile, 0)];
    expect(exposedSegments(tile, segments, challenger).map((s) => s.edge)).toEqual([0]);
    expect(exposedSegments(tile, segments, [hex(9, 9)])).toEqual([]);
  });

  it('is the weakest exposed one, a tie going to the lowest edge', () => {
    const challenger = [edgeNeighbor(tile, 0), edgeNeighbor(tile, 1), edgeNeighbor(tile, 5)];
    const exposed = exposedSegments(tile, segments, challenger);
    expect(weakestSegment(exposed)).toMatchObject({ edge: 1, hp: 40 });
    expect(weakestSegment([])).toBeNull();
  });
});

describe('fence data and numbers', () => {
  it('rules parse, and every fence has a material element and edge slot', () => {
    expect(FenceRulesSchema.parse(FENCE_RULES)).toEqual(FENCE_RULES);
    // One fence per element (owner decision 2026-10-07, second mockup).
    expect(FENCES.map((f) => [f.id, f.element])).toEqual([
      ['hedge', 'leaf'],
      ['moat', 'water'],
      ['stone-wall', 'stone'],
      ['emberwood-palisade', 'fire'],
      ['glimmer-rail', 'spark'],
      ['lantern-fence', 'light'],
      ['bramble-hedge', 'shadow'],
      ['ice-wall', 'frost'],
    ]);
    expect(new Set(FENCES.map((f) => f.element)).size).toBe(ELEMENTS.length);
    for (const f of FENCES) expect([f.slot, f.placement]).toEqual(['edge', 'owned']);
    // The Palisade burns Emberwood (#203): it competes with Hearthfire fuel.
    expect(wood.levels[0]!.cost['emberwood']).toBeGreaterThan(0);
  });

  it('gives every fence the same energy and toughness at a level: only the element differs', () => {
    for (const f of FENCES) {
      expect(f.levels.map((l) => [l.hp, l.defense])).toEqual(
        wood.levels.map((l) => [l.hp, l.defense]),
      );
    }
  });

  it('gets tougher each level', () => {
    for (const f of FENCES) {
      for (let i = 1; i < f.levels.length; i++) {
        expect(f.levels[i]!.hp).toBeGreaterThan(f.levels[i - 1]!.hp);
        expect(f.levels[i]!.defense).toBeGreaterThanOrEqual(f.levels[i - 1]!.defense);
      }
    }
  });

  it('builds a battle setup from a segment, starting at its energy', () => {
    const setup = fenceBattleSetup('seg', wood, 2, 55, FENCE_RULES);
    expect(BattleFenceSetupSchema.parse(setup)).toEqual(setup);
    expect(setup).toMatchObject({
      fence: 'emberwood-palisade',
      level: 2,
      element: 'fire',
      energy: 55,
    });
    expect(setup.stats).toEqual(fenceStats(wood, 2, FENCE_RULES));
    // Never more than it holds, never 0 for a standing fence.
    expect(fenceBattleSetup('seg', wood, 1, 999, FENCE_RULES).energy).toBe(70);
    expect(fenceBattleSetup('seg', wood, 1, 0, FENCE_RULES).energy).toBe(1);
  });

  it('repairs for a share of what it cost, scaled by what it lost', () => {
    expect(fenceRepairCost(wood, 1, 70, FENCE_RULES)).toEqual({});
    // 40% lost of a 6 Emberwood + 2 Timber fence at 25%: rounded up per item.
    expect(fenceRepairCost(wood, 1, 42, FENCE_RULES)).toEqual({ emberwood: 1, timber: 1 });
    // Nearly gone: a quarter of the build cost, rounded up.
    expect(fenceRepairCost(wood, 1, 1, FENCE_RULES)).toEqual({ emberwood: 2, timber: 1 });
    // Upgraded fences cost more to mend: everything spent counts.
    const l3 = fenceRepairCost(wood, 3, 1, FENCE_RULES);
    expect(l3['glimmer']).toBe(1);
    expect(l3['emberwood']).toBeGreaterThan(2);
  });

  it('keeps what it lost through an upgrade, and shows a whole percent', () => {
    expect(fenceHpAfterUpgrade(wood, 1, 70)).toBe(100);
    expect(fenceHpAfterUpgrade(wood, 1, 42)).toBe(72);
    expect(fencePercent(42, 70)).toBe(60);
    expect(fencePercent(1, 1000)).toBe(1);
    expect(fencePercent(0, 70)).toBe(0);
  });
});
