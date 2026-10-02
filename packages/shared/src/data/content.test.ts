import { describe, expect, it } from 'vitest';
import { BUILDINGS } from './buildings.js';
import { CARE_ACTIONS } from './care-actions.js';
import { MAP_GEN } from './map-gen.js';
import { MOVES, SPECIES } from './species.js';
import { SEASONS } from './seasons.js';
import { TERRAINS } from './terrains.js';

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

  it('ships the launch roster (#10); fixtures stay in tests/', () => {
    expect(SPECIES.length).toBeGreaterThan(0);
    expect(MOVES.length).toBeGreaterThan(0);
    const ids = [...SPECIES, ...MOVES].map((row) => row.id);
    expect(ids.filter((id) => id.startsWith('fixture-') || id.startsWith('placeholder-'))).toEqual(
      [],
    );
  });

  it('sizes maps 9 / 11 / 12 for 2 / 3 / 4 players (design doc §3)', () => {
    expect(MAP_GEN.layouts.map((l) => [l.players, l.radius])).toEqual([
      [2, 9],
      [3, 11],
      [4, 12],
    ]);
  });

  it('has the design doc terrain set plus the Gap', () => {
    expect(TERRAINS.map((t) => t.id)).toEqual([
      'meadow',
      'forest',
      'old-forest',
      'hills',
      'mountains',
      'lake',
      'pumpkin-fields',
      'junipers-gap',
    ]);
  });

  it('guarantees Timber, Stone, Emberwood and a farm plot in every home ring', () => {
    expect([...MAP_GEN.homeRingNodes].sort()).toEqual(['emberwood', 'stone', 'timber', 'treats']);
  });
});
