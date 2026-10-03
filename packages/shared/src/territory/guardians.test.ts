import { describe, expect, it } from 'vitest';
import { FIXTURE_SPECIES } from '../../tests/fixtures/sample-content.js';
import { SEASONS } from '../data/seasons.js';
import { deriveSeed } from '../rng/index.js';
import type { GuardianRules } from '../schemas/data/guardian-rules.js';
import { spawnWindowAt } from '../spawns/window.js';
import { GuardianHintSchema } from '../schemas/maps.js';
import {
  guardianTier,
  hintForGuardians,
  resolveGuardians,
  type GuardianData,
} from './guardians.js';

// fixture-pebblesnooze is a Halloween species; the others aren't seasonal.
const RULES: GuardianRules = {
  windowHours: 24,
  strengths: [
    { strength: 1, count: 1, levels: { min: 2, max: 3 } },
    { strength: 3, count: 2, levels: { min: 6, max: 8 } },
    { strength: 5, count: 3, levels: { min: 14, max: 16 } },
  ],
  hint: { easyUpTo: 5, toughUpTo: 20 },
  tables: [
    {
      id: 'forest',
      terrains: ['forest'],
      entries: [
        { species: 'fixture-puddlepuff', weight: 1 },
        { species: 'fixture-pebblesnooze', weight: 1 },
      ],
    },
    {
      id: 'meadow-halloween',
      terrains: ['meadow'],
      season: 'halloween',
      entries: [{ species: 'fixture-emberbun', weight: 1 }],
    },
  ],
};
const DATA: GuardianData = {
  rules: RULES,
  species: new Map(FIXTURE_SPECIES.map((s) => [s.id, s])),
  seasons: SEASONS,
};
const window = (date: string) => spawnWindowAt({ date, hour: 12 }, RULES.windowHours);
const guardians = (terrain: string, strength: number | null, date = '2026-10-02', q = 1) =>
  resolveGuardians(
    {
      seed: deriveSeed('map', 'guardian', q, 0, window(date).id),
      terrain,
      strength,
      window: window(date),
    },
    DATA,
  );

describe('resolveGuardians', () => {
  it('is fixed for a tile and window (no rerolls)', () => {
    expect(guardians('forest', 3)).toEqual(guardians('forest', 3));
    const teams = Array.from({ length: 30 }, (_, q) => guardians('forest', 3, '2026-10-02', q));
    expect(new Set(teams.map((t) => JSON.stringify(t))).size).toBeGreaterThan(1);
  });

  it('sizes and levels the team by strength, with unique ids', () => {
    expect(guardians('forest', 1)).toHaveLength(1);
    const strong = guardians('forest', 5);
    expect(strong.map((g) => g.id)).toEqual(['guardian-1', 'guardian-2', 'guardian-3']);
    for (const g of strong) {
      expect(g.level).toBeGreaterThanOrEqual(14);
      expect(g.level).toBeLessThanOrEqual(16);
    }
  });

  it('uses the strongest tier at or below the strength, and the weakest for none', () => {
    expect(guardianTier(RULES, 2).strength).toBe(1);
    expect(guardianTier(RULES, 4).strength).toBe(3);
    expect(guardianTier(RULES, 9).strength).toBe(5);
    expect(guardianTier(RULES, null).strength).toBe(1);
  });

  it('honours seasons and terrains', () => {
    const species = (date: string) =>
      new Set(
        Array.from({ length: 40 }, (_, q) => guardians('forest', 1, date, q)).flatMap((t) =>
          t.map((g) => g.speciesId),
        ),
      );
    expect(species('2026-09-30')).toEqual(new Set(['fixture-puddlepuff']));
    expect(species('2026-10-02')).toEqual(new Set(['fixture-puddlepuff', 'fixture-pebblesnooze']));
    expect(guardians('meadow', 1, '2026-10-31')[0]!.speciesId).toBe('fixture-emberbun');
    expect(guardians('meadow', 1, '2026-12-01')).toEqual([]);
    expect(guardians('lake', 1)).toEqual([]);
  });
});

describe('hintForGuardians', () => {
  const team = (...levels: number[]) => levels.map((level) => ({ level }));

  it('counts the team and bands its total level (easy, tough, very tough)', () => {
    expect(hintForGuardians(team(5), RULES)).toEqual({ count: 1, difficulty: 'easy' });
    expect(hintForGuardians(team(3, 3), RULES)).toEqual({ count: 2, difficulty: 'tough' });
    expect(hintForGuardians(team(10, 10), RULES)).toEqual({ count: 2, difficulty: 'tough' });
    expect(hintForGuardians(team(10, 11), RULES)).toEqual({ count: 2, difficulty: 'very-tough' });
  });

  it('is null for land nobody guards', () => {
    expect(hintForGuardians([], RULES)).toBeNull();
  });

  it('says only how many and how tough, never who or what level', () => {
    const hint = hintForGuardians(guardians('forest', 5), RULES);
    expect(GuardianHintSchema.strict().parse(hint)).toEqual({ count: 3, difficulty: 'very-tough' });
    expect(JSON.stringify(hint)).not.toMatch(/fixture|level|species|guardian-/);
  });
});
