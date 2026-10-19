import { describe, expect, it } from 'vitest';
import { CLOTHING } from '../data/clothing.js';
import { TRICK_OR_TREAT_PRIZES } from '../data/server/trick-or-treat-prizes.js';
import type { ClothingItem } from '../schemas/data/clothing.js';
import type { TrickOrTreatPrizes } from '../schemas/data/trick-or-treat-prizes.js';
import { rollTrickOrTreat, type TrickOrTreatInput } from './roll.js';

const base: TrickOrTreatInput = {
  mapSeed: 'map-seed',
  visitorUserId: '00000000-0000-7000-8000-000000000001',
  hostUserId: '00000000-0000-7000-8000-000000000002',
  day: '2026-10-20',
  lantern: false,
  owned: new Set(),
};

/** Every visit of one visitor to one host over `days` days. */
const visits = (
  days: number,
  input: Partial<TrickOrTreatInput> = {},
  prizes = TRICK_OR_TREAT_PRIZES,
) =>
  Array.from({ length: days }, (_, i) =>
    rollTrickOrTreat(
      {
        ...base,
        ...input,
        day: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      },
      prizes,
      CLOTHING,
    ),
  );

/** Only one kind of treat comes up. */
const only = (kind: 'heartdust' | 'keeper-costume' | 'squishy-costume'): TrickOrTreatPrizes => ({
  ...TRICK_OR_TREAT_PRIZES,
  plain: {
    heartdust: { ...TRICK_OR_TREAT_PRIZES.plain.heartdust, weight: kind === 'heartdust' ? 1 : 0 },
    keeperCostume: { weight: kind === 'keeper-costume' ? 1 : 0 },
    squishyCostume: { weight: kind === 'squishy-costume' ? 1 : 0 },
  },
});

describe('rollTrickOrTreat (#515)', () => {
  it('rolls the same treat for the same visit, and afresh for another day or home', () => {
    const once = rollTrickOrTreat(base, TRICK_OR_TREAT_PRIZES, CLOTHING);
    expect(rollTrickOrTreat(base, TRICK_OR_TREAT_PRIZES, CLOTHING)).toEqual(once);
    const others = [
      ...visits(40),
      ...visits(40, { hostUserId: '00000000-0000-7000-8000-000000000003' }),
    ];
    expect(new Set(others.map((v) => JSON.stringify(v))).size).toBeGreaterThan(3);
  });

  it('plays a silly trick about 1 visit in 8, and every kind of treat comes up', () => {
    const many = visits(800);
    const tricks = many.filter((v) => v.trick).length;
    expect(tricks).toBeGreaterThan(60);
    expect(tricks).toBeLessThan(140);
    const kinds = new Set(many.map((v) => v.prize.kind));
    expect(kinds).toEqual(new Set(['heartdust', 'keeper-costume', 'squishy-costume']));
  });

  it('gives more Heartdust and more costumes at a lit lantern home', () => {
    const plain = visits(800);
    const lit = visits(800, { lantern: true });
    const dust = (vs: typeof plain) =>
      vs.filter((v) => v.prize.kind === 'heartdust').map((v) => v.prize.count);
    expect(Math.min(...dust(lit))).toBeGreaterThanOrEqual(Math.max(...dust(plain)));
    expect(dust(lit).length).toBeLessThan(dust(plain).length);
  });

  it('only gives costumes the visitor lacks, then Heartdust once they have them all', () => {
    const keeperOnly = only('keeper-costume');
    const ids = CLOTHING.filter(
      (i) => i.slot === 'costume' && i.sources.includes('trick-or-treat'),
    ).map((i) => i.id);
    const owned = new Set(ids.slice(1));
    for (const v of visits(30, { owned }, keeperOnly)) {
      expect(v.prize).toEqual({ kind: 'keeper-costume', itemId: ids[0], count: 1 });
    }
    for (const v of visits(30, { owned: new Set(ids) }, keeperOnly)) {
      expect(v.prize).toEqual({ kind: 'heartdust', itemId: 'heartdust', count: 1 });
    }
  });

  it('gives a squishy costume from the catalog, or Heartdust while there are none', () => {
    const squishy = (i: ClothingItem) =>
      i.slot === 'squishy' && i.sources.includes('trick-or-treat');
    const roll = (catalog: readonly ClothingItem[]) =>
      rollTrickOrTreat(base, only('squishy-costume'), catalog).prize;
    const got = roll(CLOTHING);
    expect(got.kind).toBe('squishy-costume');
    expect(CLOTHING.filter(squishy).map((i) => i.id)).toContain(got.itemId);
    expect(roll(CLOTHING.filter((i) => !squishy(i)))).toEqual({
      kind: 'heartdust',
      itemId: 'heartdust',
      count: 1,
    });
  });

  it('rolls a rarer costume less often: the epic Vampire Cape against the commons', () => {
    const squishy = (i: ClothingItem) =>
      i.slot === 'squishy' && i.sources.includes('trick-or-treat');
    const catalog = CLOTHING.filter(squishy);
    const cape = catalog.find((i) => i.id === 'vampire-cape');
    expect(cape?.rarity).toBe('epic');
    const commons = catalog.filter((i) => i.rarity === 'common');
    expect(commons.length).toBeGreaterThan(0);
    const rolls = visits(2000, {}, only('squishy-costume')).map((v) => v.prize.itemId);
    const count = (id: string) => rolls.filter((r) => r === id).length;
    const capes = count('vampire-cape');
    expect(capes).toBeGreaterThan(0);
    for (const common of commons) expect(capes).toBeLessThan(count(common.id));
  });

  it('never gives a Keeper costume from a squishy roll, or the other way round', () => {
    const squishyIds = new Set(
      CLOTHING.filter((i) => i.slot === 'squishy' && i.sources.includes('trick-or-treat')).map(
        (i) => i.id,
      ),
    );
    const keeperIds = new Set(
      CLOTHING.filter((i) => i.slot === 'costume' && i.sources.includes('trick-or-treat')).map(
        (i) => i.id,
      ),
    );
    for (const v of visits(300, {}, only('squishy-costume'))) {
      expect(squishyIds.has(v.prize.itemId)).toBe(true);
      expect(keeperIds.has(v.prize.itemId)).toBe(false);
    }
    for (const v of visits(300, {}, only('keeper-costume'))) {
      expect(keeperIds.has(v.prize.itemId)).toBe(true);
      expect(squishyIds.has(v.prize.itemId)).toBe(false);
    }
  });
});
