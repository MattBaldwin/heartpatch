import { CLOTHING, findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { WARDROBE_TEXT } from './wardrobe-screen.js';

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'function'
      ? strings((value as (arg: never) => unknown)('Witch Hat' as never))
      : typeof value === 'object' && value !== null
        ? Object.values(value).flatMap(strings)
        : [];

describe('wardrobe words (style guide)', () => {
  it('uses none of the avoided words, in the screen or the catalog', () => {
    const catalog = CLOTHING.flatMap((item) => [item.name, item.description]);
    const texts = [...strings(WARDROBE_TEXT), ...catalog];
    expect(texts.length).toBeGreaterThan(40);
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });

  it('keeps buttons short: one or two words, three at most', () => {
    const buttons = [
      WARDROBE_TEXT.open,
      WARDROBE_TEXT.saveLook,
      WARDROBE_TEXT.cancel,
      WARDROBE_TEXT.turn,
      WARDROBE_TEXT.turnBack,
      WARDROBE_TEXT.done,
      WARDROBE_TEXT.retry,
      WARDROBE_TEXT.outfit(1),
      WARDROBE_TEXT.spot(3),
      ...Object.values(WARDROBE_TEXT.tabs),
      ...Object.values(WARDROBE_TEXT.rarities),
    ];
    for (const label of buttons) expect(label.split(' ').length).toBeLessThanOrEqual(3);
  });
});
