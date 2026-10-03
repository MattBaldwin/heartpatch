import { findAvoidedWords, GAME_DATA, STARTERS } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  chooseLabel,
  preselectedCard,
  STARTER_TEXT,
  starterCards,
  starterSpots,
} from './starter-view.js';

describe('starter screen view', () => {
  it('shows the three starters in data order, with element and feeling names', () => {
    const cards = starterCards();
    expect(cards.map((c) => c.speciesId)).toEqual(STARTERS.speciesIds);
    const puddlepuff = cards.find((c) => c.speciesId === 'puddlepuff');
    expect(puddlepuff).toMatchObject({
      name: 'Puddlepuff',
      element: 'Water',
      feeling: 'Silly',
      label: 'Puddlepuff, Water and Silly',
    });
    for (const card of cards) {
      const species = GAME_DATA.species.find((s) => s.id === card.speciesId);
      expect(card.description).toBe(species?.description);
      expect(card.color).toBe(species?.visual.palette[0]);
    }
  });

  it('names the pick on the button only once one is tapped', () => {
    const [first] = starterCards();
    expect(chooseLabel(null)).toBe('Choose');
    expect(chooseLabel(first ?? null)).toBe(`Choose ${first?.name ?? ''}`);
  });

  it('lines the squishies up left to right, centred', () => {
    expect(starterSpots(3, 2)).toEqual([-2, 0, 2]);
    expect(starterSpots(1, 2)).toEqual([0]);
  });

  it('keeps its words short and kind (style guide §2, §9)', () => {
    for (const line of Object.values(STARTER_TEXT)) {
      expect(findAvoidedWords(line), line).toEqual([]);
      expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(12);
    }
  });

  it("starts on the tutorial Partner's card, when it's one of the three", () => {
    const cards = starterCards();
    expect(preselectedCard(cards, 'thistlepip')?.speciesId).toBe('thistlepip');
    expect(preselectedCard(cards, null)).toBeNull();
    expect(preselectedCard(cards, 'fuzzbolt')).toBeNull();
  });
});
