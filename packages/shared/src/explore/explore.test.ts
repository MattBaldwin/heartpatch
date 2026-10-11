import { describe, expect, it } from 'vitest';
import { scanPlayerFacingText } from '../data/avoided-words.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { GAME_DATA } from '../data/index.js';
import { HEX_DIRECTIONS, hexToWorld, hexSpiral, hex } from '../hex/index.js';
import { hashString } from '../rng/index.js';
import { checkExploreRules, MAX_SEARCH_SPOTS, type ExploreRules } from '../schemas/data/explore.js';
import {
  exploreLayout,
  exploreNeeds,
  homesteadQuantity,
  isExplorable,
  isFullyExplored,
  isSearched,
  searchedCount,
  searchSpots,
  withSearched,
  type SearchSpot,
} from './index.js';

const SEED = 'explore-test-seed';
const SQRT3 = Math.sqrt(3);

/** Every explorable terrain on a spread of tiles. */
function sampleLayouts(rules: ExploreRules = EXPLORE_RULES) {
  return rules.terrains.flatMap((t) =>
    hexSpiral(hex(0, 0), 4).map((h) => ({
      terrain: t.terrain,
      entry: t,
      spots: searchSpots(SEED, { ...h, terrain: t.terrain }, rules) ?? [],
    })),
  );
}

describe('explore rules data', () => {
  it('passes its own checks', () => {
    expect(checkExploreRules(EXPLORE_RULES, GAME_DATA)).toEqual([]);
  });

  it('reports unknown terrains and kinds, missing tools and short tiles', () => {
    const broken: ExploreRules = {
      ...EXPLORE_RULES,
      tools: EXPLORE_RULES.tools.filter((t) => t.id !== 'net'),
      terrains: [
        { terrain: 'moon', kinds: [{ kind: 'rock', weight: 1 }], spots: { min: 1, max: 2 } },
        {
          terrain: 'lake',
          kinds: [
            { kind: 'pond', weight: 1 },
            { kind: 'puddle', weight: 1 },
          ],
          spots: { min: 4, max: 6 },
        },
        {
          terrain: 'hills',
          kinds: [
            { kind: 'ledge', weight: 1 },
            { kind: 'cave', weight: 1 },
            { kind: 'rock', weight: 1 },
          ],
          spots: { min: 2, max: 6 },
        },
      ],
    };
    const problems = checkExploreRules(broken, GAME_DATA);
    expect(problems).toContain('terrains[0]: unknown terrain "moon"');
    expect(problems).toContain('terrains[1].kinds[1]: unknown spot kind "puddle"');
    expect(problems).toContain('terrains[1].kinds[0]: no tools row for "net"');
    expect(problems).toContain('terrains[2]: spots.min is less than its 3 tool groups');
    expect(problems).toContain('spot kind "mound" is on no terrain');
  });

  it('makes each tool recipe give exactly its uses', () => {
    const shortShovel = {
      ...GAME_DATA,
      recipes: GAME_DATA.recipes.map((r) =>
        r.id === 'shovel' ? { ...r, output: { ...r.output, quantity: 5 } } : r,
      ),
    };
    expect(checkExploreRules(EXPLORE_RULES, shortShovel)).toEqual([
      'tools[0]: recipe "shovel" makes 5 uses, not 20',
    ]);
  });

  it('refuses more spots than the progress mask holds', () => {
    const tooMany = {
      ...EXPLORE_RULES,
      terrains: [{ ...EXPLORE_RULES.terrains[0], spots: { min: 8, max: MAX_SEARCH_SPOTS + 1 } }],
    };
    expect(checkExploreRules(tooMany, GAME_DATA)).not.toEqual([]);
  });

  it('lets you explore every terrain but Juniper’s Gap and trading posts (owner decision 2026-10-07, #269)', () => {
    const explorable = GAME_DATA.terrains
      .map((t) => t.id)
      .filter((id) => isExplorable(id, EXPLORE_RULES));
    expect(explorable.sort()).toEqual(
      GAME_DATA.terrains
        .map((t) => t.id)
        // Nobody owns a trading post (#269), so nobody explores one.
        .filter((id) => id !== 'junipers-gap' && id !== 'trading-post')
        .sort(),
    );
  });

  it('asks for the owner’s tools on each terrain', () => {
    const needs = Object.fromEntries(
      EXPLORE_RULES.terrains.map((t) => [t.terrain, exploreNeeds(t.terrain, EXPLORE_RULES)]),
    );
    expect(needs).toEqual({
      meadow: ['shovel'],
      forest: ['shovel'],
      'old-forest': ['shovel'],
      'pumpkin-fields': ['shovel'],
      lake: ['net'],
      hills: ['lantern'], // #335: the cave
      mountains: ['rope'], // #335: the trail
    });
    expect(exploreNeeds('junipers-gap', EXPLORE_RULES)).toEqual([]);
  });

  it('keeps avoided words out of every name', () => {
    expect(scanPlayerFacingText(EXPLORE_RULES, 'EXPLORE_RULES')).toEqual([]);
  });
});

describe('searchSpots', () => {
  const meadow = { q: 3, r: -2, terrain: 'meadow' };

  it('is the same for the same map seed, tile and layout', () => {
    expect(searchSpots(SEED, meadow, EXPLORE_RULES)).toEqual(
      searchSpots(SEED, meadow, EXPLORE_RULES),
    );
  });

  it('pins layout 1, so a change that moves spots must bump `layout`', () => {
    // If this fails on purpose, bump EXPLORE_RULES.layout (or the terrain's
    // own) and update the hash: saved progress is read against the layout it
    // was made under. Hills and mountains moved to their own layout 2 (#335).
    const layouts = ['meadow', 'lake'].map((terrain) =>
      searchSpots(SEED, { q: 1, r: 2, terrain }, EXPLORE_RULES),
    );
    expect(hashString(JSON.stringify(layouts))).toBe('a82a50ab271a1cc770650507efa10ed6');
  });

  it('differs from tile to tile, from map to map and from layout to layout', () => {
    const a = searchSpots(SEED, meadow, EXPLORE_RULES);
    expect(searchSpots(SEED, { ...meadow, q: 4 }, EXPLORE_RULES)).not.toEqual(a);
    expect(searchSpots('another-map', meadow, EXPLORE_RULES)).not.toEqual(a);
    expect(searchSpots(SEED, meadow, { ...EXPLORE_RULES, layout: 2 })).not.toEqual(a);
  });

  it('has nothing to search on land you can’t explore', () => {
    expect(searchSpots(SEED, { q: 0, r: 0, terrain: 'junipers-gap' }, EXPLORE_RULES)).toBeNull();
  });

  it('gives every tile its terrain’s count and every tool it lists', () => {
    for (const { terrain, entry, spots } of sampleLayouts()) {
      expect(spots.length, terrain).toBeGreaterThanOrEqual(entry.spots.min);
      expect(spots.length, terrain).toBeLessThanOrEqual(entry.spots.max);
      expect(spots.map((s) => s.index)).toEqual(spots.map((_, i) => i));
      const tools = new Set(spots.map((s) => s.tool).filter((t) => t !== null));
      expect([...tools].sort(), terrain).toEqual([...exploreNeeds(terrain, EXPLORE_RULES)].sort());
      const kinds = new Set(entry.kinds.map((k) => k.kind));
      for (const s of spots) expect(kinds.has(s.kind), s.kind).toBe(true);
    }
  });

  it('keeps spots inside the tile, clear of building spots and of each other', () => {
    const { buildingSpotScale, buildingClearance, minGap, edgeMargin } = EXPLORE_RULES.placement;
    const buildings = [hex(0, 0), ...HEX_DIRECTIONS].map((o) => hexToWorld(o, buildingSpotScale));
    // Squared distances, as the generator measures them (on the rounded points).
    const apart = (a: { x: number; z: number }, b: { x: number; z: number }, gap: number) =>
      (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z) >= gap * gap;
    const slack = 1e-9;
    for (const { spots } of sampleLayouts()) {
      spots.forEach((s: SearchSpot, i) => {
        const r = 1 - edgeMargin + slack;
        expect(Math.abs(s.x)).toBeLessThanOrEqual((SQRT3 / 2) * r);
        expect(Math.abs(s.x) / SQRT3 + Math.abs(s.z)).toBeLessThanOrEqual(r);
        for (const b of buildings) expect(apart(s, b, buildingClearance)).toBe(true);
        for (const other of spots.slice(i + 1)) expect(apart(s, other, minGap)).toBe(true);
      });
    }
  });
});

describe('homesteadQuantity', () => {
  it('gives the shipped bonus on every cycle (owner decision 2026-10-07: yield, not speed)', () => {
    expect(EXPLORE_RULES.homestead).toEqual({ yieldPercent: 100, yieldPlus: 1 });
    expect(homesteadQuantity(1, EXPLORE_RULES)).toBe(2);
    expect(homesteadQuantity(5, EXPLORE_RULES)).toBe(6);
  });

  it('scales by a percent rounded up, then adds', () => {
    const quarter = { homestead: { yieldPercent: 125, yieldPlus: 0 } };
    expect([1, 2, 4, 5].map((q) => homesteadQuantity(q, quarter))).toEqual([2, 3, 5, 7]);
    const both = { homestead: { yieldPercent: 150, yieldPlus: 1 } };
    expect(homesteadQuantity(3, both)).toBe(6);
    const none = { homestead: { yieldPercent: 100, yieldPlus: 0 } };
    expect(homesteadQuantity(4, none)).toBe(4);
  });
});

describe('search progress', () => {
  it('sets and reads one bit per spot', () => {
    let mask = 0;
    mask = withSearched(mask, 0);
    mask = withSearched(mask, 29);
    expect(isSearched(mask, 0)).toBe(true);
    expect(isSearched(mask, 1)).toBe(false);
    expect(isSearched(mask, 29)).toBe(true);
    expect(mask).toBeGreaterThan(0);
    expect(mask).toBeLessThanOrEqual(0x7fff_ffff);
    expect(withSearched(mask, 0)).toBe(mask);
    expect(() => withSearched(mask, MAX_SEARCH_SPOTS)).toThrow(RangeError);
    expect(() => withSearched(mask, -1)).toThrow(RangeError);
  });

  it('counts searched spots and knows when a tile is done', () => {
    let mask = 0;
    for (let i = 0; i < 11; i++) mask = withSearched(mask, i);
    expect(searchedCount(mask, 12)).toBe(11);
    expect(isFullyExplored(mask, 12)).toBe(false);
    expect(isFullyExplored(withSearched(mask, 11), 12)).toBe(true);
    expect(isFullyExplored(0, 0)).toBe(false);
  });
});

describe('per-terrain layout (#335)', () => {
  const bumped = (terrain: string): ExploreRules => ({
    ...EXPLORE_RULES,
    terrains: EXPLORE_RULES.terrains.map((t) => (t.terrain === terrain ? { ...t, layout: 2 } : t)),
  });

  it('defaults to the rules layout', () => {
    for (const t of EXPLORE_RULES.terrains) {
      expect(exploreLayout(t.terrain, EXPLORE_RULES)).toBe(t.layout ?? EXPLORE_RULES.layout);
    }
  });

  it("moves only the bumped terrain's spots", () => {
    const rules = bumped('forest');
    expect(exploreLayout('forest', rules)).toBe(2);
    expect(exploreLayout('meadow', rules)).toBe(EXPLORE_RULES.layout);
    const tiles = hexSpiral(hex(0, 0), 3);
    const same = (terrain: string) =>
      tiles.every(
        (h) =>
          JSON.stringify(searchSpots(SEED, { ...h, terrain }, rules)) ===
          JSON.stringify(searchSpots(SEED, { ...h, terrain }, EXPLORE_RULES)),
      );
    expect(same('meadow')).toBe(true);
    expect(same('lake')).toBe(true);
    expect(same('forest')).toBe(false);
  });

  it('a terrain with its own layout equal to the rules layout lays out the same', () => {
    const rules: ExploreRules = {
      ...EXPLORE_RULES,
      terrains: EXPLORE_RULES.terrains.map((t) => ({ ...t, layout: EXPLORE_RULES.layout })),
    };
    for (const h of hexSpiral(hex(0, 0), 2)) {
      expect(searchSpots(SEED, { ...h, terrain: 'forest' }, rules)).toEqual(
        searchSpots(SEED, { ...h, terrain: 'forest' }, EXPLORE_RULES),
      );
    }
  });
});
