import { describe, expect, it } from 'vitest';
import { scanPlayerFacingText } from '../data/avoided-words.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { GAME_DATA } from '../data/index.js';
import { isWater } from '../schemas/data/terrains.js';
import { HEX_DIRECTIONS, hexToWorld, hexSpiral, hex } from '../hex/index.js';
import { hashString } from '../rng/index.js';
import {
  checkExploreRules,
  MAX_SEARCH_SPOTS,
  SearchSpotKindSchema,
  type ExploreRules,
} from '../schemas/data/explore.js';
import {
  backReach,
  exploreKitFor,
  exploreLayout,
  exploreNeeds,
  homesteadQuantity,
  isExplorable,
  isFullyExplored,
  isSearched,
  RIVER_EDGE_KIT,
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

  it('lets you explore every land terrain but Juniper’s Gap, trading posts and cleared land (owner decision 2026-10-07, #269, #242)', () => {
    const explorable = GAME_DATA.terrains
      .map((t) => t.id)
      .filter((id) => isExplorable(id, EXPLORE_RULES));
    expect(explorable.sort()).toEqual(
      GAME_DATA.terrains
        // Water is never land (Wild Isle, #621), but a river tile is explored
        // as its bank (#621 W1-13).
        .filter((t) => !isWater(t) || t.id === 'river')
        .map((t) => t.id)
        // Nobody owns a trading post (#269), so nobody explores one. Cleared
        // land (#242) was a homestead, explored already, before it was cleared.
        .filter((id) => id !== 'junipers-gap' && id !== 'trading-post' && id !== 'clearing')
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
      coast: ['shovel', 'net'], // #621 W1-11: hands, the Shovel and the Snorkel
      river: ['shovel', 'net'], // #621 W1-13: the same three on the river bank
    });
    expect(exploreNeeds('junipers-gap', EXPLORE_RULES)).toEqual([]);
  });

  it('dives to bubble springs and parts reed beds with the Snorkel, keeping the old ids (#335)', () => {
    const kind = (id: string) => EXPLORE_RULES.spotKinds.find((k) => k.id === id);
    expect(kind('pond')).toEqual({
      id: 'pond',
      name: 'Bubble spring',
      tool: 'net',
      interaction: 'dive',
    });
    expect(kind('reeds')).toEqual({
      id: 'reeds',
      name: 'Reed bed',
      tool: 'net',
      interaction: 'part',
    });
    // Additive: the old interactions still validate.
    for (const interaction of ['lift', 'shake', 'dig', 'scoop', 'climb', 'light', 'dive', 'part']) {
      const spot = { id: 'x', name: 'X', tool: null, interaction };
      expect(SearchSpotKindSchema.safeParse(spot).success, interaction).toBe(true);
    }
    expect(
      SearchSpotKindSchema.safeParse({ id: 'x', name: 'X', tool: null, interaction: 'swim' })
        .success,
    ).toBe(false);
  });

  it('picks each tile’s own kit, with the river-edge rule ready but off (#621 W1-13)', () => {
    expect(RIVER_EDGE_KIT).toBe(false);
    expect(exploreKitFor('meadow', ['river', 'forest'], EXPLORE_RULES)).toBe('meadow');
    expect(exploreKitFor('river', [], EXPLORE_RULES)).toBe('river');
    // Switched on: explorable land beside a river explores as its bank.
    expect(exploreKitFor('meadow', ['forest', 'river'], EXPLORE_RULES, true)).toBe('river');
    expect(exploreKitFor('coast', ['river'], EXPLORE_RULES, true)).toBe('river');
    // Not without a river next door, and never for land nobody explores.
    expect(exploreKitFor('meadow', ['forest', 'wild-lake'], EXPLORE_RULES, true)).toBe('meadow');
    expect(exploreKitFor('junipers-gap', ['river'], EXPLORE_RULES, true)).toBe('junipers-gap');
    expect(exploreKitFor('ocean', ['river'], EXPLORE_RULES, true)).toBe('ocean');
  });

  it('gives the river bank hands, the Shovel and the Snorkel, with existing gestures (#621 W1-13)', () => {
    const river = EXPLORE_RULES.terrains.find((t) => t.terrain === 'river');
    expect(river?.layout).toBeUndefined();
    const kinds = (river?.kinds ?? []).map((k) =>
      EXPLORE_RULES.spotKinds.find((s) => s.id === k.kind),
    );
    expect(kinds.map((k) => [k?.id, k?.tool, k?.interaction])).toEqual([
      ['mossy-log', null, 'lift'],
      ['pebble-bar', 'shovel', 'dig'],
      ['eddy', 'net', 'dive'],
      ['cattails', 'net', 'part'],
    ]);
    expect(exploreNeeds('river', EXPLORE_RULES)).toEqual(['shovel', 'net']);
  });

  it('gives the coast hands, the Shovel and the Snorkel, with the lake’s gestures (#621 W1-11)', () => {
    const coast = EXPLORE_RULES.terrains.find((t) => t.terrain === 'coast');
    expect(coast?.layout).toBeUndefined();
    const kinds = (coast?.kinds ?? []).map((k) =>
      EXPLORE_RULES.spotKinds.find((s) => s.id === k.kind),
    );
    expect(kinds.map((k) => [k?.id, k?.tool, k?.interaction])).toEqual([
      ['shells', null, 'lift'],
      ['driftwood', null, 'lift'],
      ['crab-hole', 'shovel', 'dig'],
      ['tide-pool', 'net', 'dive'],
      ['kelp-bed', 'net', 'part'],
    ]);
    // Every tile of it has all three: hands, the Shovel and the Snorkel.
    const tools = new Set(kinds.map((k) => k?.tool ?? null));
    expect(tools).toEqual(new Set([null, 'shovel', 'net']));
    expect(exploreNeeds('coast', EXPLORE_RULES)).toEqual(['shovel', 'net']);
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

  it('lays out every terrain without a band exactly as before bands (#621 W1-13)', () => {
    // A golden hash of every unbanded terrain's spots on two maps, taken
    // before `band` was added: an optional band must change nothing else.
    const unbanded = EXPLORE_RULES.terrains.filter((t) => !t.band);
    expect(unbanded.map((t) => t.terrain)).not.toContain('river');
    const layouts = ['golden-a', 'golden-b'].flatMap((seed) =>
      unbanded.flatMap((t) =>
        hexSpiral(hex(0, 0), 2).map((at) =>
          searchSpots(seed, { ...at, terrain: t.terrain }, EXPLORE_RULES),
        ),
      ),
    );
    expect(hashString(JSON.stringify(layouts))).toBe('5548ad6e8da809f8cf553e3bd162e435');
  });

  it('keeps a banded terrain’s spots within its band of the back edges (#621 W1-13)', () => {
    const river = EXPLORE_RULES.terrains.find((t) => t.terrain === 'river');
    expect(river?.band).toBeDefined();
    const depth = river?.band?.depth ?? 0;
    for (const seed of [SEED, 'another-map']) {
      for (const at of hexSpiral(hex(0, 0), 4)) {
        const spots = searchSpots(seed, { ...at, terrain: 'river' }, EXPLORE_RULES) ?? [];
        expect(spots.length).toBeGreaterThanOrEqual(river?.spots.min ?? 1);
        for (const s of spots) {
          expect(backReach(s.x, s.z)).toBeGreaterThanOrEqual(1 - depth);
          expect(backReach(s.x, s.z)).toBeLessThanOrEqual(1);
        }
      }
    }
    // The reach: 0 in the middle, 1 on either back edge and in the back corner.
    expect(backReach(0, 0)).toBe(0);
    expect(backReach(0, 1)).toBeCloseTo(1, 9);
    expect(backReach(Math.sqrt(3) / 2, 0.5)).toBeCloseTo(1, 9);
    expect(backReach(-Math.sqrt(3) / 4, 0.75)).toBeCloseTo(1, 9);
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
