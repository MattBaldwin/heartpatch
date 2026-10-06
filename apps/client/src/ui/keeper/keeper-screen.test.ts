import { defaultKeeperConfig, findAvoidedWords, KEEPER_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { KEEPER_TEXT, styleOf, withHairstyle } from './keeper-screen.js';

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

describe('Keeper picker hair style row', () => {
  const rowan = KEEPER_DATA.bases.find((b) => b.id === 'rowan')!;
  const config = defaultKeeperConfig(rowan);

  it('shows the base’s own style until another is picked', () => {
    expect(styleOf(config)).toBe('crew-cut');
    expect(styleOf(withHairstyle(config, 'long'))).toBe('long');
  });

  it('keeps the base and colours when the style changes', () => {
    expect(withHairstyle(config, 'messy-mop')).toEqual({ ...config, hairstyle: 'messy-mop' });
  });

  it('stores the base’s own style as none, so it reads like an old save', () => {
    const picked = withHairstyle(withHairstyle(config, 'bob'), 'crew-cut');
    expect(picked).toEqual(config);
    expect(picked).not.toHaveProperty('hairstyle');
  });

  it('lists every style with a short name for a 44 px pill, no boy or girl labels', () => {
    for (const style of KEEPER_DATA.hairstyles) {
      expect(style.name.split(' ').length).toBeLessThanOrEqual(2);
      expect(style.name).not.toMatch(/\b(boys?|girls?|male|female)\b/i);
    }
  });
});
