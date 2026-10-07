import { CLOTHING_RARITIES, findAvoidedWords, RaritySchema, type Rarity } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { WARDROBE_TEXT } from '../wardrobe/wardrobe-screen.js';
import { RARITY_NAMES, rarityClass, rarityName } from './rarity.js';
import rarityCss from './rarity.css?raw';
import wardrobeCss from '../wardrobe/wardrobe.css?raw';

describe('rarity words and colours (#240)', () => {
  it('names every rarity, Secret included', () => {
    expect(RaritySchema.options.map(rarityName)).toEqual([
      'Common',
      'Uncommon',
      'Rare',
      'Epic',
      'Legendary',
      'Secret',
    ]);
    expect(findAvoidedWords(Object.values(RARITY_NAMES).join(' '))).toEqual([]);
  });

  it("gives every rarity a colour class, with the wardrobe's colours unchanged", () => {
    const sheet = rarityCss;
    const colour = (rarity: Rarity) =>
      new RegExp(`\\.${rarityClass(rarity)} \\{\\s*--rarity: (#[0-9a-f]{6});`).exec(sheet)?.[1];
    expect(Object.fromEntries(RaritySchema.options.map((r) => [r, colour(r)]))).toEqual({
      common: '#8fbf8a',
      uncommon: '#4fa36b',
      rare: '#4f8fd6',
      epic: '#8a62c4',
      legendary: '#e0a12a',
      secret: '#d9468b',
    });
  });

  it('is the one place clothing and squishies get rarity from, so they cannot drift', () => {
    for (const r of CLOTHING_RARITIES) expect(WARDROBE_TEXT.rarities[r]).toBe(RARITY_NAMES[r]);
    // The wardrobe no longer keeps its own copy of the colours, but still uses them.
    expect(wardrobeCss).toMatch(/var\(--rarity\)/);
    expect(wardrobeCss).not.toMatch(/--rarity:/);
  });
});
