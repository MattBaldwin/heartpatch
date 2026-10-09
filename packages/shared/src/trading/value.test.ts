import { describe, expect, it } from 'vitest';
import { CLOTHING } from '../data/clothing.js';
import { GAME_DATA } from '../data/index.js';
import { TRADE_VALUES } from '../data/trading.js';
import type { Species } from '../schemas/data/species.js';
import { checkTradeValues } from '../schemas/data/trading.js';
import {
  createTradeValuer,
  evolutionStages,
  heartsOf,
  tradeBalance,
  tradeValuer,
  type ValuedLine,
} from './value.js';

const pet = (speciesId: string | null, level: number): ValuedLine => ({
  kind: 'squishy',
  speciesId,
  level,
});
const items = (itemId: string, quantity: number): ValuedLine => ({
  kind: 'item',
  itemId,
  quantity,
});
const species = (id: string): Species => GAME_DATA.species.find((s) => s.id === id)!;

describe('TRADE_VALUES', () => {
  it('passes its checks: every tradable item has a value', () => {
    expect(checkTradeValues(TRADE_VALUES, GAME_DATA.resources)).toEqual([]);
  });

  it('refuses a missing item, a tool, an unknown item and heart steps that go down', () => {
    const { timber: _timber, ...noTimber } = TRADE_VALUES.items;
    expect(
      checkTradeValues(
        {
          ...TRADE_VALUES,
          items: { ...noTimber, shovel: 5, moonbeams: 2 },
          hearts: [40, 30, 200, 400],
        },
        GAME_DATA.resources,
      ),
    ).toEqual([
      'items: timber has no value',
      "items: shovel isn't a tradable item",
      "items: moonbeams isn't a tradable item",
      'hearts: each step must be more than the one before',
    ]);
    expect(checkTradeValues({ ...TRADE_VALUES, evenBand: 2 }, GAME_DATA.resources)).not.toEqual([]);
  });
});

describe('evolutionStages', () => {
  it('counts each species’ steps from its first form', () => {
    const stages = evolutionStages(GAME_DATA.species);
    expect(stages.get('emberbun')).toBe(1);
    expect(stages.get('hearthbun')).toBe(2);
    for (const s of GAME_DATA.species) expect(stages.get(s.id)).toBeGreaterThanOrEqual(1);
  });

  it('stops on a loop in the data instead of hanging', () => {
    const a = { ...species('emberbun'), id: 'a', evolutions: [{ into: 'b', level: 5 }] };
    const b = { ...species('emberbun'), id: 'b', evolutions: [{ into: 'a', level: 5 }] };
    expect(evolutionStages([a, b]).get('a')).toBeLessThanOrEqual(3);
  });
});

describe('tradeValuer', () => {
  const values = {
    ...TRADE_VALUES,
    squishyRarity: { ...TRADE_VALUES.squishyRarity, common: 40, uncommon: 60, rare: 100 },
    stage: [1, 2],
    levelStep: 0.5,
    mysteryRarity: 'uncommon' as const,
    items: { ...TRADE_VALUES.items, timber: 4 },
    clothingRarity: { ...TRADE_VALUES.clothingRarity, common: 30 },
  };
  const ember = species('emberbun');
  const hearth = species('hearthbun');
  const valuer = createTradeValuer({
    values,
    species: [ember, hearth],
    synergy: { fire: { cozy: 1.2 } } as never,
    clothing: CLOTHING,
  });

  it('values a squishy by rarity, stage, synergy and level', () => {
    expect(ember).toMatchObject({ rarity: 'common', element: 'fire', feeling: 'cozy' });
    // 40 × stage 1 × synergy 1.2 × (1 + 0.5 × 2)
    expect(valuer.lineValue(pet('emberbun', 3))).toBeCloseTo(40 * 1 * 1.2 * 2);
    // Its evolution is stage 2.
    expect(valuer.lineValue(pet('hearthbun', 1))).toBeCloseTo(
      values.squishyRarity[hearth.rarity] * 2 * (hearth.element === 'fire' ? 1.2 : 1),
    );
  });

  it('values a species the viewer hasn’t met at the plain middle value, whatever it is', () => {
    expect(valuer.lineValue(pet(null, 3))).toBe(60 * 2);
    // An id this client doesn't know counts the same, never as zero.
    expect(valuer.lineValue(pet('not-in-the-data', 3))).toBe(60 * 2);
  });

  it('values each item in a stack, and a clothing piece by its rarity', () => {
    expect(valuer.lineValue(items('timber', 3))).toBe(12);
    expect(valuer.lineValue(items('not-an-item', 3))).toBe(0);
    const common = CLOTHING.find((c) => c.rarity === 'common' && c.tradable !== false)!;
    expect(valuer.lineValue({ kind: 'clothing', itemId: common.id })).toBe(30);
    expect(valuer.lineValue({ kind: 'clothing', itemId: 'nope' })).toBe(0);
  });

  it('adds up a side', () => {
    expect(valuer.sideValue([items('timber', 1), items('timber', 2)])).toBe(12);
    expect(valuer.sideValue([])).toBe(0);
  });

  it('uses the game’s own data by default', () => {
    expect(tradeValuer.lineValue(pet('emberbun', 9))).toBeGreaterThan(
      tradeValuer.lineValue(pet('emberbun', 1)),
    );
  });
});

describe('heartsOf', () => {
  it('shows 0 for nothing, at least 1 for anything, and 5 at most', () => {
    const [two, three, four, five] = TRADE_VALUES.hearts;
    expect(heartsOf(0)).toBe(0);
    expect(heartsOf(1)).toBe(1);
    expect(heartsOf(two - 1)).toBe(1);
    expect(heartsOf(two)).toBe(2);
    expect(heartsOf(three)).toBe(3);
    expect(heartsOf(four)).toBe(4);
    expect(heartsOf(five)).toBe(5);
    expect(heartsOf(five * 100)).toBe(5);
  });
});

describe('tradeBalance', () => {
  it('waits until both sides have something', () => {
    expect(tradeBalance(0, 50)).toEqual({ tip: 'none', lopsided: false });
    expect(tradeBalance(50, 0)).toEqual({ tip: 'none', lopsided: false });
  });

  it('is even within 15% of the bigger side, either way', () => {
    expect(tradeBalance(100, 100)).toEqual({ tip: 'even', lopsided: false });
    expect(tradeBalance(100, 85)).toEqual({ tip: 'even', lopsided: false });
    expect(tradeBalance(85, 100)).toEqual({ tip: 'even', lopsided: false });
    expect(tradeBalance(100, 84)).toEqual({ tip: 'them', lopsided: false });
    expect(tradeBalance(84, 100)).toEqual({ tip: 'me', lopsided: false });
  });

  it('is lopsided from twice as much', () => {
    expect(tradeBalance(100, 51)).toEqual({ tip: 'them', lopsided: false });
    expect(tradeBalance(100, 50)).toEqual({ tip: 'them', lopsided: true });
    expect(tradeBalance(50, 100)).toEqual({ tip: 'me', lopsided: true });
  });
});
