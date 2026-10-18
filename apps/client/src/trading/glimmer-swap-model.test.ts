import { GLIMMER_SWAP, type GlimmerSwapView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { hoursToReset, SWAP_TEXT, swapCards, swapsLeft } from './glimmer-swap-model.js';

const view = (over: Partial<GlimmerSwapView> = {}): GlimmerSwapView => ({
  swappedToday: 1,
  resetsAt: '2026-11-05T07:00:00.000Z',
  have: { timber: 12, stone: 24, greens: 6, water: 30, ice: 3, glimmer: 2 },
  ...over,
});

describe('the Glimmer swap tab (#523)', () => {
  it('shows every accepted resource in data order, with what I have', () => {
    const cards = swapCards(view());
    expect(cards.map((c) => c.itemId)).toEqual(GLIMMER_SWAP.accepts);
    expect(cards.map((c) => [c.name, c.have])).toEqual([
      ['Timber', 12],
      ['Stone', 24],
      ['Greens', 6],
      ['Water', 30],
      ['Ice', 3],
    ]);
  });

  it('lets me swap only what I have enough of, and nothing at the cap', () => {
    expect(
      swapCards(view())
        .filter((c) => c.canSwap)
        .map((c) => c.itemId),
    ).toEqual(['timber', 'stone', 'water']);
    const capped = view({ swappedToday: GLIMMER_SWAP.dailyCap });
    expect(swapsLeft(capped)).toBe(0);
    expect(swapCards(capped).some((c) => c.canSwap)).toBe(false);
  });

  it('says the confirm, the day and the reset in short words', () => {
    expect(SWAP_TEXT.confirm('stone', GLIMMER_SWAP)).toBe('Swap 10 Stone for 1 💎?');
    expect(SWAP_TEXT.today(view(), GLIMMER_SWAP)).toBe('Today: 1 of 3 💎');
    const now = Date.parse('2026-11-05T01:30:00.000Z');
    expect(hoursToReset(view(), now)).toBe(6);
    expect(SWAP_TEXT.resetsIn(hoursToReset(view(), Date.parse('2026-11-05T06:40:00Z')))).toBe(
      'New swaps in less than an hour',
    );
  });
});
