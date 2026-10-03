import { CLOTHING_BY_ID, findAvoidedWords, type Boutique } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { BOUTIQUE_TEXT, buyState, previewWearing, racksOf } from './boutique-view.js';

const item = (itemId: string, owned = false) => ({
  itemId,
  price: CLOTHING_BY_ID.get(itemId)!.boutiquePrice!,
  owned,
});

const BOUTIQUE: Boutique = {
  date: '2026-10-15',
  restocksAt: '2026-10-16T06:00:00.000Z',
  daily: [item('pom-pom-beanie'), item('big-bow', true)],
  seasonal: [{ seasonId: 'halloween', items: [item('witch-hat')] }],
  coins: { balance: 20 },
};

describe('buyState', () => {
  it('offers what the player can afford, says how many more for the rest, and marks owned', () => {
    expect(buyState(item('pom-pom-beanie'), 15)).toEqual({ kind: 'buy' });
    expect(buyState(item('witch-hat'), 20)).toEqual({ kind: 'short', need: 10 });
    expect(buyState(item('big-bow', true), 0)).toEqual({ kind: 'owned' });
  });
});

describe('racksOf', () => {
  it("shows today's rack first, then each season's, and skips empty ones", () => {
    const racks = racksOf(BOUTIQUE, () => 'Halloween');
    expect(racks.map((r) => [r.id, r.title, r.items.length])).toEqual([
      ['daily', 'Today’s rack', 2],
      ['halloween', 'Halloween rack', 1],
    ]);
    expect(racksOf({ ...BOUTIQUE, seasonal: [], daily: [] }, () => '')).toEqual([]);
  });
});

describe('previewWearing', () => {
  it('tries a piece on in its own slot, over what was there', () => {
    expect(previewWearing(['sunny-cap', 'cozy-sweater'], 'witch-hat', CLOTHING_BY_ID)).toEqual([
      'witch-hat',
      'cozy-sweater',
    ]);
    expect(previewWearing(['cozy-sweater'], 'ghost-sheet', CLOTHING_BY_ID)).toEqual([
      'cozy-sweater',
      'ghost-sheet',
    ]);
  });

  it('leaves the outfit as it is for nothing, a squishy accessory, or what is already worn', () => {
    const worn = ['sunny-cap'];
    expect(previewWearing(worn, null, CLOTHING_BY_ID)).toEqual(worn);
    expect(previewWearing(worn, 'snuggle-scarf', CLOTHING_BY_ID)).toEqual(worn);
    expect(previewWearing(worn, 'sunny-cap', CLOTHING_BY_ID)).toEqual(worn);
    expect(previewWearing(worn, 'no-such-thing', CLOTHING_BY_ID)).toEqual(worn);
  });
});

describe('Boutique words (style guide)', () => {
  const strings = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : typeof value === 'function'
        ? [String((value as (a: never, b: never) => unknown)('Witch Hat' as never, 30 as never))]
        : typeof value === 'object' && value !== null
          ? Object.values(value).flatMap(strings)
          : [];
  const texts = strings(BOUTIQUE_TEXT);

  it('uses none of the avoided words, and never talks about money or ads', () => {
    expect(texts.length).toBeGreaterThan(15);
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
    for (const text of texts) {
      expect(text).not.toMatch(/\$|£|€|dollar|money|cash|pay|purchase|buy now|\bad\b|ads\b/i);
    }
  });

  it('keeps buttons short', () => {
    const buttons = [
      BOUTIQUE_TEXT.open,
      BOUTIQUE_TEXT.buy,
      BOUTIQUE_TEXT.notNow,
      BOUTIQUE_TEXT.okay,
      BOUTIQUE_TEXT.back,
      BOUTIQUE_TEXT.retry,
    ];
    for (const label of buttons) expect(label.split(' ').length).toBeLessThanOrEqual(2);
  });
});
