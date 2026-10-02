import { describe, expect, it } from 'vitest';
import { BUILDINGS } from './buildings.js';
import { CARE_ACTIONS } from './care-actions.js';
import { MOVES, SPECIES } from './species.js';
import { SEASONS } from './seasons.js';

describe('decisions encoded in data (docs/DECISIONS.md)', () => {
  it('has exactly the feed, pet and play care actions', () => {
    expect(CARE_ACTIONS.map((c) => c.id)).toEqual(['feed', 'pet', 'play']);
  });

  it('lets a Hearthfire store up to 5 nights of Emberwood', () => {
    const fire = BUILDINGS.find((b) => b.kind === 'hearthfire');
    expect(fire).toMatchObject({ fuelResource: 'emberwood', maxFuelNights: 5 });
  });

  it('has the four holiday seasons, with Halloween 2026 running to Nov 9', () => {
    expect(SEASONS.map((s) => s.id)).toEqual([
      'halloween',
      'thanksgiving',
      'christmas',
      'new-year',
    ]);
    const halloween = SEASONS.find((s) => s.id === 'halloween');
    expect(halloween?.window).toEqual({ start: '10-01', end: '11-02' });
    expect(halloween?.overrides?.['2026']).toEqual({ start: '10-01', end: '11-09' });
  });

  it('ships no species or moves yet: the roster is issue #10, fixtures stay in tests/', () => {
    expect(SPECIES).toEqual([]);
    expect(MOVES).toEqual([]);
  });
});
