import { describe, expect, it } from 'vitest';
import { RAIL_RULES } from '../data/rails.js';
import { TRAVEL_RULES } from '../data/travel.js';
import { GAME_DATA } from '../data/index.js';
import { hexKey } from '../hex/index.js';
import { generateMap } from '../mapgen/index.js';
import { patchRules } from '../patch-types/index.js';
import { attackTargetProblem } from './index.js';
import { railCost, railSpeedPercent, withRails } from './rails.js';
import { supplyMap, type SupplyTile } from './reach.js';

const ME = '00000000-0000-4000-8000-000000000001';

/** Home at q = 0, my land q = 1…3 along r = 0, neutral land past it. */
function tiles(n: number): SupplyTile[] {
  return Array.from({ length: n }, (_, q) => ({
    q,
    r: 0,
    terrain: 'meadow',
    ownerUserId: q <= 3 ? ME : null,
    homeSlot: q === 0 ? 0 : null,
  }));
}

const reachOn = (
  rails: { level: number }[],
  roads: { level: number }[] = [],
): ReadonlyMap<string, number> => {
  const spot = (level: number) => ({ q: 3, r: 0, ownerUserId: ME, level });
  const folded = withRails(
    roads.map((r) => spot(r.level)),
    rails.map((r) => spot(r.level)),
    TRAVEL_RULES,
    RAIL_RULES,
  );
  return supplyMap(tiles(12), folded.roads, [], ME, folded.rules).reach;
};

describe('rails (Clockwork Isle, #874)', () => {
  it('claims reach along a rail by its level', () => {
    const [one, two] = RAIL_RULES.levels;
    const far = (reach: ReadonlyMap<string, number>) =>
      Math.max(...[...reach.keys()].map((k) => Number(k.split(',')[0])));
    expect(far(reachOn([{ level: 1 }]))).toBe(3 + (one?.reach ?? 0));
    expect(far(reachOn([{ level: 2 }]))).toBe(3 + (two?.reach ?? 0));
  });

  it('a road and a rail on one tile: the further reach wins', () => {
    // A Paved road (3) beats a Rail (2); a Tidy rail (3) beats a Path (1).
    expect(reachOn([{ level: 1 }], [{ level: 3 }]).has(hexKey({ q: 6, r: 0 }))).toBe(true);
    expect(reachOn([{ level: 2 }], [{ level: 1 }]).has(hexKey({ q: 6, r: 0 }))).toBe(true);
  });

  it('changes nothing without rail rules (Cozy and Wild)', () => {
    const roads = [{ q: 1, r: 0, ownerUserId: ME, level: 1 }];
    const rails = [{ q: 2, r: 0, ownerUserId: ME, level: 2 }];
    const folded = withRails(roads, rails, TRAVEL_RULES, null);
    expect(folded.rules).toBe(TRAVEL_RULES);
    expect(folded.roads).toEqual(roads);
  });

  it('paces a gatherer and prices each level from the data', () => {
    expect(railSpeedPercent(1, RAIL_RULES)).toBe(RAIL_RULES.levels[0]?.speedPercent);
    expect(railSpeedPercent(null, RAIL_RULES)).toBeNull();
    expect(railSpeedPercent(1, null)).toBeNull();
    expect(railCost(1, RAIL_RULES)).toEqual(RAIL_RULES.levels[0]?.cost);
    expect(railCost(3, RAIL_RULES)).toBeNull();
  });

  it("leaves a Cozy Patch's attackTargetProblem unchanged on every tile, rails or not", () => {
    const map = generateMap(GAME_DATA, { seed: 'cozy-rails', playerCount: 4 });
    const owners = map.homes.map((_, slot) => `keeper-${String(slot)}`);
    const tiles = map.tiles.map((t) => ({
      ...t,
      ownerUserId: t.homeSlot !== null ? owners[t.homeSlot]! : null,
    }));
    // A stray rail on every owned tile: Cozy has no rail (or travel) rules.
    const rails = tiles.flatMap((t) =>
      t.ownerUserId ? [{ ...t, ownerUserId: t.ownerUserId, level: 2 }] : [],
    );
    const cozy = patchRules('cozy');
    expect(cozy.rails).toBeNull();
    expect(cozy.travel).toBeNull();
    const folded = withRails([], rails, TRAVEL_RULES, cozy.rails);
    expect(folded.roads).toEqual([]);
    for (const userId of owners) {
      const plain = supplyMap(tiles, [], [], userId, TRAVEL_RULES);
      const withLines = supplyMap(tiles, folded.roads, [], userId, folded.rules);
      for (const t of tiles) {
        expect(attackTargetProblem(t, tiles, userId, 'on', withLines)).toBe(
          attackTargetProblem(t, tiles, userId, 'on', plain),
        );
      }
    }
  });
});
