import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { TRADE_RULES } from '../data/trading.js';
import { checkGameData } from '../schemas/data/game-data.js';
import { isTradableResource } from '../schemas/data/resources.js';
import { checkTradeRules } from '../schemas/data/trading.js';
import type { TradeLine } from '../schemas/trading.js';
import { offerProblem, sideProblem, type OfferSide, type OfferSquishy } from './offer.js';

const squishy = (id: string, extra: Partial<OfferSquishy> = {}): OfferSquishy => ({
  id,
  state: 'active',
  resting: true,
  starter: false,
  ...extra,
});

const side = (extra: Partial<OfferSide> = {}): OfferSide => ({
  squishies: [squishy('partner', { starter: true }), squishy('pip'), squishy('bun')],
  items: { timber: 10, shovel: 3 },
  tradableItems: new Set(['timber']),
  clothing: [
    { id: 'hat', tradable: true, held: false },
    { id: 'scarf', tradable: false, held: false },
    { id: 'cape', tradable: true, held: true },
  ],
  ...extra,
});

const pet = (squishyId: string): TradeLine => ({ kind: 'squishy', squishyId });
const timber = (quantity: number): TradeLine => ({ kind: 'item', itemId: 'timber', quantity });
const piece = (clothingId: string): TradeLine => ({ kind: 'clothing', clothingId });

describe('TRADE_RULES and tradable items', () => {
  it('pass their checks', () => {
    expect(checkTradeRules(TRADE_RULES)).toEqual([]);
    expect(checkGameData(GAME_DATA)).toEqual([]);
  });

  it('keeps explore tools with their Keeper, and lets everything else trade', () => {
    const tools = GAME_DATA.resources.filter((r) => r.tool !== undefined);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(isTradableResource(tool), tool.id).toBe(false);
    expect(isTradableResource(GAME_DATA.resources.find((r) => r.id === 'timber')!)).toBe(true);
    const tradableTool = GAME_DATA.resources.map((r) =>
      r.tool !== undefined ? { ...r, tradable: true } : r,
    );
    expect(checkGameData({ ...GAME_DATA, resources: tradableTool }).join()).toMatch(
      /never tradable/,
    );
  });
});

describe('offerProblem (owner decisions Q1 and Q2 on #30)', () => {
  const ok = { kind: 'trade' as const, give: [pet('pip')], want: [timber(3)] };

  it('lets a resting squishy go for items', () => {
    expect(offerProblem(ok, side(), side(), TRADE_RULES)).toBeNull();
  });

  it('needs something to give, and a trade asks for something', () => {
    expect(offerProblem({ ...ok, give: [] }, side(), side(), TRADE_RULES)).toBe('empty');
    expect(offerProblem({ ...ok, want: [] }, side(), side(), TRADE_RULES)).toBe('empty');
  });

  it('lets a gift ask for nothing back', () => {
    const gift = { kind: 'gift' as const, give: [timber(2)], want: [] };
    expect(offerProblem(gift, side(), side(), TRADE_RULES)).toBeNull();
    expect(offerProblem({ ...gift, want: [timber(1)] }, side(), side(), TRADE_RULES)).toBe(
      'gift-wants',
    );
  });

  it('never moves a patch starter, a busy squishy, or the last friend', () => {
    expect(sideProblem([pet('partner')], side(), TRADE_RULES)).toBe('starter');
    const busy = side({ squishies: [squishy('pip', { resting: false }), squishy('bun')] });
    expect(sideProblem([pet('pip')], busy, TRADE_RULES)).toBe('busy');
    const hollowed = side({ squishies: [squishy('pip', { state: 'hollowed' }), squishy('bun')] });
    expect(sideProblem([pet('pip')], hollowed, TRADE_RULES)).toBe('busy');
    const inTrade = side({ squishies: [squishy('pip', { state: 'in-trade' }), squishy('bun')] });
    expect(sideProblem([pet('pip')], inTrade, TRADE_RULES)).toBe('busy');
    // Pip and Bun are both resting, but the Partner counts as a friend who stays.
    expect(sideProblem([pet('pip'), pet('bun')], side(), TRADE_RULES)).toBeNull();
    const alone = side({ squishies: [squishy('pip'), squishy('bun')] });
    expect(sideProblem([pet('pip'), pet('bun')], alone, TRADE_RULES)).toBe('last-friend');
    expect(sideProblem([pet('pip')], alone, TRADE_RULES)).toBeNull();
  });

  it('refuses what the owner lacks, tools, account-bound and held pieces', () => {
    expect(sideProblem([pet('nobody')], side(), TRADE_RULES)).toBe('not-theirs');
    expect(sideProblem([timber(11)], side(), TRADE_RULES)).toBe('not-theirs');
    expect(
      sideProblem([{ kind: 'item', itemId: 'shovel', quantity: 1 }], side(), TRADE_RULES),
    ).toBe('not-tradable');
    expect(sideProblem([piece('hat')], side(), TRADE_RULES)).toBeNull();
    expect(sideProblem([piece('scarf')], side(), TRADE_RULES)).toBe('not-tradable');
    expect(sideProblem([piece('cape')], side(), TRADE_RULES)).toBe('not-tradable');
    expect(sideProblem([piece('gone')], side(), TRADE_RULES)).toBe('not-theirs');
  });

  it('keeps to the limits and lists each thing once', () => {
    const many = Array.from({ length: TRADE_RULES.linesPerSide + 1 }, (_, i) =>
      piece(`p${String(i)}`),
    );
    expect(sideProblem(many, side(), TRADE_RULES)).toBe('too-many-lines');
    const pets = side({
      squishies: [squishy('a'), squishy('b'), squishy('c'), squishy('d'), squishy('e')],
    });
    const four = ['a', 'b', 'c', 'd'].map(pet);
    expect(sideProblem(four, pets, TRADE_RULES)).toBe('too-many-squishies');
    expect(sideProblem([timber(1), timber(2)], side(), TRADE_RULES)).toBe('twice');
  });

  it('checks the want side against the patch-mate', () => {
    const theirs = side({ squishies: [squishy('fizz'), squishy('pop')] });
    const offer = { kind: 'trade' as const, give: [timber(1)], want: [pet('fizz')] };
    expect(offerProblem(offer, side(), theirs, TRADE_RULES)).toBeNull();
    expect(offerProblem({ ...offer, want: [pet('pip')] }, side(), theirs, TRADE_RULES)).toBe(
      'not-theirs',
    );
  });
});
