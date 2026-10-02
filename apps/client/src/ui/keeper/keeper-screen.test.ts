import { findAvoidedWords, KEEPER_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { KEEPER_TEXT } from './keeper-screen.js';

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'object' && value !== null
      ? Object.values(value).flatMap(strings)
      : [];

describe('Keeper picker words (style guide)', () => {
  it('uses none of the avoided words', () => {
    const texts = [...strings(KEEPER_TEXT), ...strings(KEEPER_DATA)];
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });

  it('keeps buttons short: one or two words, three at most', () => {
    const buttons = [...Object.values(KEEPER_TEXT.save), KEEPER_TEXT.back, KEEPER_TEXT.retry];
    for (const label of [...buttons, KEEPER_TEXT.settingsButton]) {
      expect(label.split(' ').length).toBeLessThanOrEqual(3);
    }
  });
});
