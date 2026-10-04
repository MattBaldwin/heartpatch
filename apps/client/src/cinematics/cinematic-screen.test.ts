import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { CINEMATIC_TEXT } from './cinematic-screen.js';

describe('opening cinematic words (style guide)', () => {
  it('uses none of the avoided words', () => {
    expect(Object.values(CINEMATIC_TEXT).flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });

  it('keeps buttons short: one or two words, three at most', () => {
    for (const label of [CINEMATIC_TEXT.skip, CINEMATIC_TEXT.hold, CINEMATIC_TEXT.settingsButton]) {
      expect(label.split(' ').length).toBeLessThanOrEqual(3);
    }
  });
});
