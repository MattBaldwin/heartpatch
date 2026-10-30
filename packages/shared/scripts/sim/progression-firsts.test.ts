import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../../src/data/index.js';
import type { Rarity } from '../../src/schemas/data/common.js';
import {
  FIRSTS,
  firstsFacts,
  firstsGate,
  firstsOf,
  formatFirst,
  formatFirstsGate,
  type First,
  type FirstDay,
  type FirstsFacts,
} from './progression-firsts.js';
import { PROGRESSION_CONFIG } from './progression-config.js';
import type { DayRecord } from './progression.js';

/** A plain day; each test changes what it needs. */
const day = (n: number, over: Partial<DayRecord> = {}): DayRecord => ({
  day: n,
  partnerLevel: 5,
  partnerSpecies: 'emberbun',
  levels: [5, 3, 3],
  team: [],
  tiles: 7,
  land: [],
  neutralLeft: 10,
  neutralLeftOutsideGap: 8,
  odds: [],
  tileBattles: 0,
  wildBattles: 7,
  partnerXp: 0,
  evolved: [],
  befriended: [],
  gapWins: 0,
  ...over,
});

/** A hand-made line: a teen is a rarity step up, as in the data (design §8). */
const SPECIES: Record<string, { rarity: Rarity; stage: number }> = {
  bun: { rarity: 'common', stage: 1 },
  'bun-kid': { rarity: 'common', stage: 2 },
  glim: { rarity: 'rare', stage: 1 },
  'glim-kid': { rarity: 'rare', stage: 2 },
  'glim-teen': { rarity: 'epic', stage: 3 },
  'glim-grown': { rarity: 'legendary', stage: 4 },
  heartlet: { rarity: 'secret', stage: 1 },
  'heartlet-kid': { rarity: 'secret', stage: 2 },
};
const facts: FirstsFacts = {
  rarity: (id) => SPECIES[id]?.rarity,
  stage: (id) => SPECIES[id]?.stage ?? 1,
};
const dayOf = (firsts: readonly First[], id: string) => firsts.find((f) => f.id === id)?.day;
const gate = { kid: 'casual', windowDays: 30, maxGapDays: 5 };
const firsts = (days: readonly FirstDay[]): First[] =>
  days.map((d, i) => ({ id: String(i), label: String(i), day: d }));

describe('firstsFacts', () => {
  it('reads rarity and evolution stage from the species data', () => {
    const real = firstsFacts(new Map(GAME_DATA.species.map((sp) => [sp.id, sp])));
    const base = GAME_DATA.species.find((sp) => sp.id === 'emberbun')!;
    expect(real.stage(base.id)).toBe(1);
    expect(real.rarity(base.id)).toBe(base.rarity);
    const into = base.evolutions[0]?.into;
    expect(into && real.stage(into)).toBe(2);
  });
});

describe('firstsOf (#736)', () => {
  it('finds the first day of each modelled first, in the issue’s order', () => {
    const days = [
      day(1),
      day(2, { evolved: [{ from: 'bun', into: 'bun-kid' }] }),
      day(3, {
        befriended: ['bun', 'heartlet'],
        evolved: [{ from: 'heartlet', into: 'heartlet-kid' }],
      }),
      day(4, { befriended: ['glim'], levels: [20, 3, 3] }),
      day(5, { gapWins: 1 }),
      day(6, { evolved: [{ from: 'glim', into: 'glim-kid' }] }),
      day(7, { evolved: [{ from: 'glim-kid', into: 'glim-teen' }] }),
      day(8, { evolved: [{ from: 'glim-teen', into: 'glim-grown' }], neutralLeft: 0 }),
    ];
    const found = firstsOf(days, facts);
    expect(found.map((f) => f.id)).toEqual(FIRSTS.map((f) => f.id));
    expect(Object.fromEntries(found.map((f) => [f.id, f.day]))).toEqual({
      evolve: 2,
      lv20: 4,
      'rare-befriended': 4,
      'rare-evolved': 6,
      'gap-win': 5,
      'factory-l2': 'not modelled',
      'journey-5': 'not modelled',
      // A secret (off the rarity ladder) is neither rare nor epic; the epic teen growing up is.
      'epic-evolved': 8,
      'grown-up': 8,
      'map-full': 8,
    });
  });

  it('gives null for a first that never happens', () => {
    const found = firstsOf([day(1), day(2)], facts);
    expect(dayOf(found, 'evolve')).toBeNull();
    expect(formatFirst(null, 60)).toBe('never (> day 60)');
    expect(formatFirst(7, 60)).toBe('day 7');
    expect(formatFirst('not modelled', 60)).toBe('not modelled');
  });
});

describe('firstsGate (#736)', () => {
  it('passes when every gap from day 1 to the window’s end is short enough', () => {
    const result = firstsGate(firsts([4, 9, 14, 19, 24, 29]), gate);
    expect(result.pass).toBe(true);
    expect(result.gaps.map((g) => g.days)).toEqual([3, 5, 5, 5, 5, 5, 1]);
  });

  it('fails on a long gap, counting to the window’s end and ignoring later or missing firsts', () => {
    const result = firstsGate(firsts([3, 7, 7, null, 44, 'not modelled']), gate);
    expect(result.pass).toBe(false);
    expect(result.misses).toEqual([{ from: 7, to: 30, days: 23 }]);
    expect(formatFirstsGate(result, gate)).toContain('soft until #730');
    expect(formatFirstsGate(result, gate)).toContain('FAIL: day 7 → 30 (23 days)');
  });

  it('fails a slow start', () => {
    expect(firstsGate(firsts([8, 10, 14, 18, 22, 26, 30]), gate).misses).toEqual([
      { from: 1, to: 8, days: 7 },
    ]);
  });

  it('is set for the casual kid in the sim config', () => {
    expect(PROGRESSION_CONFIG.firstsGate.kid).toBe('casual');
    expect(PROGRESSION_CONFIG.kids.some((k) => k.id === PROGRESSION_CONFIG.firstsGate.kid)).toBe(
      true,
    );
  });
});
