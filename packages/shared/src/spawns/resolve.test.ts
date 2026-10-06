import { describe, expect, it } from 'vitest';
import { FIXTURE_SPECIES } from '../../tests/fixtures/sample-content.js';
import { SEASONS } from '../data/seasons.js';
import { SPAWN_RULES } from '../data/server/spawn-rules.js';
import { deriveSeed } from '../rng/index.js';
import type { SpawnRules } from '../schemas/data/spawn-rules.js';
import type { SpawnTable } from '../schemas/data/spawn-tables.js';
import { resolveWildSpawn, timeOfDayOf, type SpawnData } from './resolve.js';
import { spawnWindowAt } from './window.js';

const RULES: SpawnRules = { ...SPAWN_RULES, chance: 100, levels: { min: 3, max: 5 } };
// fixture-pebblesnooze is a Halloween species; the others aren't seasonal.
const TABLES: SpawnTable[] = [
  {
    id: 'forest-any',
    terrains: ['forest'],
    entries: [
      { species: 'fixture-puddlepuff', weight: 1 },
      { species: 'fixture-pebblesnooze', weight: 1 },
    ],
  },
  {
    id: 'lake-night',
    terrains: ['lake'],
    timeOfDay: 'night',
    entries: [{ species: 'fixture-snoozlet', weight: 1 }],
  },
  {
    id: 'meadow-halloween',
    terrains: ['meadow'],
    season: 'halloween',
    entries: [{ species: 'fixture-emberbun', weight: 1 }],
  },
];
const data = (over: Partial<SpawnData> = {}): SpawnData => ({
  tables: TABLES,
  species: new Map(FIXTURE_SPECIES.map((s) => [s.id, s])),
  seasons: SEASONS,
  rules: RULES,
  ...over,
});

const window = (date: string, hour = 12) => spawnWindowAt({ date, hour }, RULES.windowHours);
const spawnsOn = (terrain: string, date: string, hour = 12, d = data(), tiles = 80) =>
  Array.from({ length: tiles }, (_, q) =>
    resolveWildSpawn(
      {
        seed: deriveSeed('map-seed', 'spawn', q, 0, window(date, hour).id),
        terrain,
        window: window(date, hour),
      },
      d,
    ),
  );
const speciesOn = (...args: Parameters<typeof spawnsOn>) =>
  new Set(spawnsOn(...args).flatMap((s) => (s ? [s.speciesId] : [])));

describe('resolveWildSpawn', () => {
  it('is fixed for a tile and window (no rerolls)', () => {
    const input = {
      seed: deriveSeed('m', 'spawn', 1, 2, '2026-10-02/3'),
      terrain: 'forest',
      window: window('2026-10-02'),
    };
    expect(resolveWildSpawn(input, data())).toEqual(resolveWildSpawn(input, data()));
    expect(resolveWildSpawn(input, data())).not.toBeNull();
  });

  it('picks a level inside the rules', () => {
    for (const spawn of spawnsOn('forest', '2026-10-02')) {
      expect(spawn!.level).toBeGreaterThanOrEqual(3);
      expect(spawn!.level).toBeLessThanOrEqual(5);
    }
  });

  describe('levels that follow the Partner', () => {
    const OFFSET_RULES: SpawnRules = { ...RULES, partnerOffset: { min: -2, max: 1 } };
    const at = (q: number, partnerLevel: number | null, rules = OFFSET_RULES) =>
      resolveWildSpawn(
        {
          seed: deriveSeed('map-seed', 'spawn', q, 0, window('2026-10-02').id),
          terrain: 'forest',
          window: window('2026-10-02'),
          partnerLevel,
        },
        data({ rules }),
      );
    const tiles = Array.from({ length: 80 }, (_, q) => q);

    it('rolls the Partner’s level −2 to +1, every one of them', () => {
      const levels = new Set(tiles.map((q) => at(q, 30)!.level));
      expect([...levels].sort((a, b) => a - b)).toEqual([28, 29, 30, 31]);
    });

    it('never changes which species a tile has', () => {
      for (const q of tiles) {
        expect(at(q, 30)?.speciesId).toBe(at(q, null)?.speciesId);
        expect(at(q, 70)?.speciesId).toBe(at(q, 2)?.speciesId);
      }
    });

    it('stays within levels.min and 100', () => {
      for (const q of tiles) {
        expect(at(q, 1)!.level).toBeGreaterThanOrEqual(RULES.levels.min);
        expect(at(q, 100)!.level).toBeLessThanOrEqual(100);
      }
      expect(new Set(tiles.map((q) => at(q, 100)!.level))).toContain(100);
    });

    it('rolls the plain levels without a Partner, or without partnerOffset', () => {
      const plainRules: SpawnRules = { ...OFFSET_RULES, partnerOffset: undefined };
      for (const q of tiles) {
        expect(at(q, null)!.level).toBeLessThanOrEqual(RULES.levels.max);
        expect(at(q, 30, plainRules)!.level).toBeLessThanOrEqual(RULES.levels.max);
      }
    });
  });

  it('leaves some tiles empty at the spawn chance, and the presence roll ignores the tables', () => {
    const some = data({ rules: { ...RULES, chance: 35 } });
    const spawns = spawnsOn('forest', '2026-10-02', 12, some, 400);
    const found = spawns.filter(Boolean).length;
    expect(found).toBeGreaterThan(100);
    expect(found).toBeLessThan(180);
    // Other tables: the same tiles have someone, just maybe someone else.
    const other = data({
      rules: { ...RULES, chance: 35 },
      tables: [
        { id: 'x', terrains: ['forest'], entries: [{ species: 'fixture-snoozlet', weight: 1 }] },
      ],
    });
    const again = spawnsOn('forest', '2026-10-02', 12, other, 400);
    expect(again.map(Boolean)).toEqual(spawns.map(Boolean));
  });

  it('only matches tables for the terrain', () => {
    expect(speciesOn('mountains', '2026-10-02').size).toBe(0);
  });

  it('spawns Halloween species only inside the Halloween window', () => {
    expect(speciesOn('forest', '2026-09-30')).toEqual(new Set(['fixture-puddlepuff']));
    expect(speciesOn('forest', '2026-10-01')).toEqual(
      new Set(['fixture-puddlepuff', 'fixture-pebblesnooze']),
    );
    // The 2026 override runs Halloween to Nov 9.
    expect(speciesOn('forest', '2026-11-09').has('fixture-pebblesnooze')).toBe(true);
    expect(speciesOn('forest', '2026-11-10')).toEqual(new Set(['fixture-puddlepuff']));
    expect(speciesOn('forest', '2027-11-03')).toEqual(new Set(['fixture-puddlepuff']));
    // A Halloween table is off outside its season too.
    expect(speciesOn('meadow', '2026-10-31')).toEqual(new Set(['fixture-emberbun']));
    expect(speciesOn('meadow', '2026-12-01').size).toBe(0);
  });

  it('honours a table’s time of day', () => {
    expect(speciesOn('lake', '2026-10-02', 22)).toEqual(new Set(['fixture-snoozlet']));
    expect(speciesOn('lake', '2026-10-02', 12).size).toBe(0);
  });

  it('skips species the server doesn’t know', () => {
    const d = data({ species: new Map() });
    expect(speciesOn('forest', '2026-10-02', 12, d).size).toBe(0);
  });
});

describe('timeOfDayOf', () => {
  it('gives 4-hour windows night, day, day, day, dusk, night', () => {
    expect(
      [0, 4, 8, 12, 16, 20].map((hour) => timeOfDayOf(window('2026-10-02', hour), RULES)),
    ).toEqual(['night', 'day', 'day', 'day', 'dusk', 'night']);
  });
});
