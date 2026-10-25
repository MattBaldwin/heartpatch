import { describe, expect, it } from 'vitest';
import { TRAVEL_RULES } from '../data/travel.js';
import { hexKey } from '../hex/index.js';
import { attackTargetProblem } from './index.js';
import { supplyMap, type SupplyTile } from './reach.js';
import { clockMood, strandedClock } from './tending.js';
import { ferryShore, isLakeTerrain, lakeBodies, lakesTouching } from './water.js';

const ME = 'me';
const RULES = TRAVEL_RULES;
const HOUR_MS = 60 * 60 * 1000;
const tile = (
  q: number,
  r: number,
  terrain = 'meadow',
  ownerUserId: string | null = null,
  homeSlot: number | null = null,
) => ({ q, r, terrain, ownerUserId, homeSlot }) satisfies SupplyTile;

/**
 * My home at (0,0), my land (1,0) and my dock's homestead (2,0). A lake runs
 * east along r = 0 from (3,0) to (`to`,0) (a river at `riverAt` instead, if
 * given), with land along both banks (r = -1 and r = 1) and past its end.
 */
function lakeside(to: number, riverAt?: number): SupplyTile[] {
  const tiles: SupplyTile[] = [
    tile(0, 0, 'meadow', ME, 0),
    tile(1, 0, 'meadow', ME),
    tile(2, 0, 'meadow', ME),
  ];
  for (let q = 3; q <= to; q++) tiles.push(tile(q, 0, q === riverAt ? 'river' : 'wild-lake'));
  tiles.push(tile(to + 1, 0));
  for (let q = 0; q <= to + 2; q++) tiles.push(tile(q, -1), tile(q, 1));
  return tiles;
}

const own = (tiles: SupplyTile[], q: number, r: number, ownerUserId: string | null = ME) =>
  tiles.map((t) => (t.q === q && t.r === r ? { ...t, ownerUserId } : t));
const DOCK = { q: 2, r: 0, ownerUserId: ME };

describe('lake bodies (Wild Isle, #621 W1-5b)', () => {
  it('joins lake tiles edge to edge into one body, named by its smallest key', () => {
    const tiles = lakeside(6);
    const bodies = lakeBodies(tiles);
    expect([...bodies.keys()].sort()).toEqual(['3,0', '4,0', '5,0', '6,0']);
    expect(new Set(bodies.values())).toEqual(new Set(['3,0']));
    // Order doesn't matter.
    expect(lakeBodies([...tiles].reverse())).toEqual(bodies);
    expect(lakesTouching(bodies, { q: 2, r: 0 })).toEqual(['3,0']);
    expect(lakesTouching(bodies, { q: 0, r: 0 })).toEqual([]);
  });

  it('counts only Wild Isle lakes: Cozy’s lake is land, rivers and the ocean aren’t lakes', () => {
    expect(isLakeTerrain('wild-lake')).toBe(true);
    expect(isLakeTerrain('lake')).toBe(false);
    expect(isLakeTerrain('river')).toBe(false);
    expect(isLakeTerrain('ocean')).toBe(false);
    const cozy = lakeside(6).map((t) =>
      t.terrain === 'wild-lake' ? { ...t, terrain: 'lake' } : t,
    );
    expect(lakeBodies(cozy).size).toBe(0);
    expect(ferryShore(cozy, DOCK, 6).size).toBe(0);
  });

  it('keeps two lakes apart across a river', () => {
    const tiles = lakeside(9, 6);
    const bodies = lakeBodies(tiles);
    expect(bodies.get('5,0')).toBe('3,0');
    expect(bodies.get('7,0')).toBe('7,0');
    expect(bodies.has('6,0')).toBe(false);
    // The ferry stays on its own lake: the far lake's banks aren't reached.
    const shore = ferryShore(tiles, DOCK, 6);
    expect(shore.get('6,-1')).toBe(3); // touches (5,0), the near lake's last tile
    expect(shore.has('8,-1')).toBe(false);
    expect(shore.has('9,1')).toBe(false);
  });
});

describe('ferry reach (Wild Isle, #621 W1-5b)', () => {
  it('reaches the banks within the ferry’s range in water steps', () => {
    const tiles = lakeside(10);
    const shore = ferryShore(tiles, DOCK, RULES.ferry.range);
    expect(RULES.ferry.range).toBe(6);
    // (q,-1) touches (q-1,0), which is q-3 water steps out.
    expect(shore.get('4,-1')).toBe(1);
    expect(shore.get('9,-1')).toBe(6);
    expect(shore.has('10,-1')).toBe(false);
    expect(shore.has('11,0')).toBe(false);
    // The dock's own tile isn't a far shore.
    expect(shore.has('2,0')).toBe(false);
    // A shorter range reaches less; no lake next door reaches nothing.
    expect([...ferryShore(tiles, DOCK, 1).keys()].sort()).toEqual(
      ['3,-1', '3,1', '4,-1', '2,1'].sort(),
    );
    expect(ferryShore(tiles, { q: 0, r: 0 }, 6).size).toBe(0);
  });

  it('carries my supply line to my land on the far bank, and puts the bank in reach', () => {
    const tiles = own(lakeside(10), 8, 1);
    const without = supplyMap(tiles, [], [], ME, RULES);
    expect(without.supplied.has('8,1')).toBe(false);
    const ferried = supplyMap(tiles, [], [], ME, RULES, [DOCK]);
    expect(ferried.supplied.has('8,1')).toBe(true);
    // The lake itself is never supplied; neutral banks are claimable.
    expect(ferried.supplied.has('5,0')).toBe(false);
    expect(ferried.reach.get('6,1')).toBe(4); // touches (6,0), 4 water steps out
    expect(attackTargetProblem(tile(6, 1), tiles, ME, 'off', ferried)).toBe(null);
    expect(attackTargetProblem(tile(6, 1), tiles, ME, 'off', without)).toBe('too-far');
    expect(attackTargetProblem(tile(5, 0, 'wild-lake'), tiles, ME, 'off', ferried)).toBe('water');
  });

  it('counts only my own dock, on my supplied land, on a patch with a ferry', () => {
    const tiles = own(lakeside(10), 8, 1);
    expect(
      supplyMap(tiles, [], [], ME, RULES, [{ ...DOCK, ownerUserId: 'rival' }]).supplied.has('8,1'),
    ).toBe(false);
    // The dock's homestead is cut off from home (a rival holds (1,0)).
    const cut = own(tiles, 1, 0, 'rival');
    expect(supplyMap(cut, [], [], ME, RULES, [DOCK]).supplied.has('8,1')).toBe(false);
    // A dock left on land that isn't mine any more carries nothing.
    expect(
      supplyMap(own(tiles, 2, 0, 'rival'), [], [], ME, RULES, [DOCK]).supplied.has('8,1'),
    ).toBe(false);
    // No ferry rules: no ferry.
    const noFerry = { roads: RULES.roads, bridgesShared: RULES.bridgesShared };
    expect(supplyMap(tiles, [], [], ME, noFerry, [DOCK]).supplied.has('8,1')).toBe(false);
  });

  it('strands the far shore when the dock is lost, wild only after the grace and the stranded hours', () => {
    const tiles = own(lakeside(10), 8, 1);
    expect(supplyMap(tiles, [], [], ME, RULES, [DOCK]).supplied.has(hexKey({ q: 8, r: 1 }))).toBe(
      true,
    );
    // The dock comes down: (8,1) is cut off.
    expect(supplyMap(tiles, [], [], ME, RULES, []).supplied.has('8,1')).toBe(false);
    // `refreshSupply(…, { lostCrossing })` starts its clock after the grace.
    const lost = new Date('2026-10-25T12:00:00Z');
    const { graceHoursAfterBridgeLoss: grace, afterHours } = RULES.stranded;
    const clock = strandedClock(new Date(lost.getTime() + grace * HOUR_MS), RULES.stranded);
    const at = (hours: number) => new Date(lost.getTime() + hours * HOUR_MS);
    expect(clockMood(clock, at(grace - 1))).toBe('happy');
    expect(clockMood(clock, at(grace))).toBe('misses-you');
    expect(clockMood(clock, at(afterHours))).toBe('misses-you');
    expect(clockMood(clock, at(grace + afterHours - 1))).toBe('misses-you');
    expect(clockMood(clock, at(grace + afterHours))).toBe('going-wild');
  });
});
