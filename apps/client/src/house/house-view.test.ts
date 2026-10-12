import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { sampleHouse } from './house-fixtures.js';
import { HOUSE_TEXT, houseBeds, houseCard, peekLine } from './house-view.js';

describe('house view', () => {
  it('shows no card while the house is switched off (no `house` in the home reply)', () => {
    expect(houseCard({})).toBeNull();
  });

  it('names the level and its beds on the card', () => {
    expect(houseCard({ house: { level: 1 } })).toEqual({
      title: '🏠 Your house',
      line: 'House 1 · 2 beds',
    });
  });

  it('names the room in view, or the whole house', () => {
    const one = sampleHouse(1).view;
    expect(peekLine(one, 'Mia')).toBe('The Snug · 2 beds');
    const top = sampleHouse(99).view;
    expect(peekLine(top, 'Mia')).toBe(`Mia’s house · ${String(houseBeds(top))} beds`);
    expect(peekLine(top, 'Mia', 'snug')).toBe('The Snug · 2 beds');
    expect(peekLine(top, null)).toBe(`Your house · ${String(houseBeds(top))} beds`);
  });

  it('says it all kindly (style guide §9)', () => {
    const lines = [
      HOUSE_TEXT.card,
      HOUSE_TEXT.cardLine(2, 4),
      HOUSE_TEXT.goInside,
      HOUSE_TEXT.back,
      HOUSE_TEXT.pill(3),
      HOUSE_TEXT.sign('Mia'),
      HOUSE_TEXT.room('The Snug', 1),
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
    expect(HOUSE_TEXT.room('The Snug', 1)).toBe('The Snug · 1 bed');
  });
});
