import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { sampleHouse } from './house-fixtures.js';
import { HOUSE_TEXT, houseBeds, houseCard, keepTail, peekLine } from './house-view.js';

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

  it('names the room in view, or how many rooms and beds, never the owner', () => {
    const one = sampleHouse(1).view;
    expect(peekLine(one)).toBe('The Snug · 2 beds');
    expect(peekLine(sampleHouse(2).view)).toBe('2 rooms · 4 beds');
    const top = sampleHouse(99).view;
    expect(peekLine(top)).toBe(
      `${String(top.rooms.length)} rooms · ${String(houseBeds(top))} beds`,
    );
    expect(peekLine(top, 'snug')).toBe('The Snug · 2 beds');
  });

  it('keeps a server line’s last words together, so nothing wraps alone', () => {
    expect(keepTail('Grow your Heart Seed to level 1 🌱')).toBe(
      'Grow your Heart Seed to level\u00A01\u00A0🌱',
    );
    expect(keepTail('Light a fire 🔥')).toBe('Light a\u00A0fire\u00A0🔥');
    // Three words or fewer stay as they are.
    expect(keepTail('Build 2 habitats')).toBe('Build 2 habitats');
    // A no-break space already there joins its words into one.
    expect(keepTail('Grow to level\u00A01 🌱 now')).toBe('Grow to level\u00A01\u00A0🌱\u00A0now');
    // A double space between the last words becomes one no-break space; others stay.
    expect(keepTail('Tend  8 tiles  of land')).toBe('Tend  8 tiles\u00A0of\u00A0land');
    // Spaces at either end stay, and don't count as words.
    expect(keepTail(' Have 1 happy resident ')).toBe(' Have 1\u00A0happy\u00A0resident ');
    expect(keepTail('  a b  ')).toBe('  a b  ');
  });

  it('says it all kindly (style guide §9)', () => {
    const lines = [
      HOUSE_TEXT.card,
      HOUSE_TEXT.cardLine(2, 4),
      HOUSE_TEXT.goInside,
      HOUSE_TEXT.back,
      HOUSE_TEXT.walkIn,
      HOUSE_TEXT.stepOut,
      HOUSE_TEXT.pill(3),
      HOUSE_TEXT.sign('Mia'),
      HOUSE_TEXT.room('The Snug', 1),
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
    expect(HOUSE_TEXT.room('The Snug', 1)).toBe('The Snug · 1 bed');
  });
});
