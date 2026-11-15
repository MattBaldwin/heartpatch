import { describe, expect, it } from 'vitest';
import { FIXTURE_SECRET_SPECIES, FIXTURE_SPECIES } from '../../tests/fixtures/sample-content.js';
import { GROWTH_RULES } from '../data/care.js';
import { SEASONS } from '../data/seasons.js';
import { SPAWN_RULES } from '../data/server/spawn-rules.js';
import { deriveSeed } from '../rng/index.js';
import type { SpawnRules } from '../schemas/data/spawn-rules.js';
import type { SpawnTable } from '../schemas/data/spawn-tables.js';
import type { Species } from '../schemas/data/species.js';
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
  maxLevel: GROWTH_RULES.maxLevel,
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

    it('rolls every level in the offset range (this fixture: −2 to +1)', () => {
      const levels = new Set(tiles.map((q) => at(q, 30)!.level));
      expect([...levels].sort((a, b) => a - b)).toEqual([28, 29, 30, 31]);
    });

    it('never changes which species a tile has', () => {
      for (const q of tiles) {
        expect(at(q, 30)?.speciesId).toBe(at(q, null)?.speciesId);
        expect(at(q, 70)?.speciesId).toBe(at(q, 2)?.speciesId);
      }
    });

    it('stays within levels.min and the top level', () => {
      const top = GROWTH_RULES.maxLevel;
      for (const q of tiles) {
        expect(at(q, 1)!.level).toBeGreaterThanOrEqual(RULES.levels.min);
        expect(at(q, top)!.level).toBeLessThanOrEqual(top);
      }
      expect(new Set(tiles.map((q) => at(q, top)!.level))).toContain(top);
    });

    it('takes the rarity discount off Partner-matched levels, not plain ones', () => {
      // fixture-moonpuff is secret, fixture-splashmallow uncommon; the others are common.
      const SECRET_TABLES: SpawnTable[] = [
        {
          id: 'forest-secret',
          terrains: ['forest'],
          entries: [{ species: 'fixture-moonpuff', weight: 1 }],
        },
      ];
      const UNCOMMON_TABLES: SpawnTable[] = [
        {
          id: 'forest-uncommon',
          terrains: ['forest'],
          entries: [{ species: 'fixture-splashmallow', weight: 1 }],
        },
      ];
      const NO_DISCOUNT: SpawnRules = { ...OFFSET_RULES, rarityLevelDiscount: undefined };
      const DISCOUNT_RULES: SpawnRules = {
        ...OFFSET_RULES,
        rarityLevelDiscount: { uncommon: 1, secret: 2 },
      };
      const roll = (q: number, partnerLevel: number | null, rules: SpawnRules, tables = TABLES) =>
        resolveWildSpawn(
          {
            seed: deriveSeed('map-seed', 'spawn', q, 0, window('2026-10-02').id),
            terrain: 'forest',
            window: window('2026-10-02'),
            partnerLevel,
          },
          data({
            rules,
            tables,
            species: new Map([...FIXTURE_SPECIES, ...FIXTURE_SECRET_SPECIES].map((s) => [s.id, s])),
          }),
        )!;
      for (const q of tiles) {
        // Two levels lower than the same roll without the discount.
        expect(roll(q, 30, DISCOUNT_RULES, SECRET_TABLES).level).toBe(
          roll(q, 30, NO_DISCOUNT, SECRET_TABLES).level - 2,
        );
        // Floored at levels.min, and exactly that when the discount goes under it.
        expect(roll(q, 3, DISCOUNT_RULES, SECRET_TABLES).level).toBe(
          Math.max(RULES.levels.min, roll(q, 3, NO_DISCOUNT, SECRET_TABLES).level - 2),
        );
        // A one-level discount takes off exactly one.
        expect(roll(q, 30, DISCOUNT_RULES, UNCOMMON_TABLES).level).toBe(
          roll(q, 30, NO_DISCOUNT, UNCOMMON_TABLES).level - 1,
        );
        // A rarity it doesn't name takes off nothing.
        expect(roll(q, 30, DISCOUNT_RULES)).toEqual(roll(q, 30, NO_DISCOUNT));
        // No Partner: the plain levels, untouched.
        expect(roll(q, null, DISCOUNT_RULES, SECRET_TABLES)).toEqual(
          roll(q, null, NO_DISCOUNT, SECRET_TABLES),
        );
      }
    });

    it('rolls the plain levels without a Partner, or without partnerOffset', () => {
      const plainRules: SpawnRules = { ...OFFSET_RULES, partnerOffset: undefined };
      const plain = [RULES.levels.min, RULES.levels.max];
      const seen = new Set<number>();
      for (const q of tiles) {
        for (const level of [at(q, null)!.level, at(q, 30, plainRules)!.level]) {
          expect(level).toBeGreaterThanOrEqual(plain[0]!);
          expect(level).toBeLessThanOrEqual(plain[1]!);
          seen.add(level);
        }
      }
      expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5]);
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

describe('resolveWildSpawn with a Rare Lure (#729)', () => {
  const base = FIXTURE_SPECIES.find((s) => s.id === 'fixture-puddlepuff')!;
  const secret = FIXTURE_SECRET_SPECIES[0]!;
  /** A species of `rarity` (and an optional season), cut from a fixture. */
  const kind = (id: string, rarity: Species['rarity'], season?: string): Species => ({
    ...base,
    id,
    rarity,
    ...(season ? { season } : {}),
  });
  const SPECIES = [
    kind('c1', 'common'),
    kind('c2', 'common'),
    kind('u1', 'uncommon'),
    kind('r1', 'rare'),
    kind('e1', 'epic'),
    kind('l1', 'legendary'),
    kind('halloween-u', 'uncommon', 'halloween'),
    secret,
  ];
  const table = (
    id: string,
    terrain: string,
    species: string[],
    over: Partial<SpawnTable> = {},
  ) => ({
    id,
    terrains: [terrain],
    entries: species.map((s) => ({ species: s, weight: 1 })),
    ...over,
  });
  const LURE_TABLES: SpawnTable[] = [
    table('meadow', 'meadow', ['c1', 'c2', 'u1']),
    // Mountains have no uncommon: a lure climbs common → rare.
    table('mountain', 'mountain', ['c1', 'r1']),
    // A meadow-like tile whose best is uncommon: nothing rarer for an uncommon roll.
    table('coast', 'coast', ['c1', 'u1']),
    // Juniper's Gap: rare, epic, legendary and a secret.
    table('gap', 'junipers-gap', ['r1', 'e1', 'l1', secret.id]),
    table('only-secret', 'secret-glen', ['c1', secret.id]),
    table('halloween', 'pumpkin', ['c1', 'halloween-u']),
  ];
  const lureData = data({ tables: LURE_TABLES, species: new Map(SPECIES.map((s) => [s.id, s])) });
  const rarity = (id: string) => SPECIES.find((s) => s.id === id)!.rarity;
  /** Plain and lured rolls on `tiles` tiles of `terrain`. */
  const pairs = (terrain: string, date = '2026-10-02', tiles = 120, partnerLevel = 10) =>
    Array.from({ length: tiles }, (_, q) => {
      const input = {
        seed: deriveSeed('map-seed', 'spawn', q, 0, window(date).id),
        terrain,
        window: window(date),
        partnerLevel,
      };
      return {
        plain: resolveWildSpawn(input, lureData),
        lured: resolveWildSpawn({ ...input, lure: true }, lureData),
      };
    });

  it('a lure moves a common roll to an uncommon entry of the same tables', () => {
    const commons = pairs('meadow').filter(
      (p) => p.plain && rarity(p.plain.speciesId) === 'common',
    );
    expect(commons.length).toBeGreaterThan(5);
    for (const { lured } of commons) expect(lured).toMatchObject({ speciesId: 'u1', lured: true });
  });

  it('a lure never returns a secret species, in the Gap included', () => {
    const gap = pairs('junipers-gap', '2026-10-02', 300);
    expect(gap.some((p) => p.plain?.speciesId === secret.id)).toBe(true);
    for (const { plain, lured } of gap) {
      if (!plain) continue;
      const from = rarity(plain.speciesId);
      // rare → epic, epic → legendary; legendary and a secret roll stay plain.
      const want = { rare: 'e1', epic: 'l1' }[from as 'rare' | 'epic'];
      if (want) expect(lured).toEqual({ ...plain, speciesId: want, lured: true });
      else expect(lured).toEqual(plain);
      if (plain.speciesId !== secret.id) expect(lured!.speciesId).not.toBe(secret.id);
    }
    for (const { plain, lured } of pairs('secret-glen')) {
      if (plain) expect(lured!.speciesId === secret.id).toBe(plain.speciesId === secret.id);
    }
  });

  it('a lure climbs past a missing tier (mountains: common → rare)', () => {
    const commons = pairs('mountain').filter((p) => p.plain?.speciesId === 'c1');
    expect(commons.length).toBeGreaterThan(5);
    for (const { lured } of commons) expect(lured).toMatchObject({ speciesId: 'r1', lured: true });
  });

  it('a lure with nothing rarer returns the plain roll and no lured flag', () => {
    const uncommons = pairs('coast').filter((p) => p.plain?.speciesId === 'u1');
    expect(uncommons.length).toBeGreaterThan(5);
    for (const { plain, lured } of uncommons) expect(lured).toEqual(plain);
  });

  it('the lured species is stable for the same seed, and the level is the plain roll’s', () => {
    const a = pairs('meadow');
    const b = pairs('meadow');
    expect(a).toEqual(b);
    for (const { plain, lured } of a) if (plain) expect(lured!.level).toBe(plain.level);
  });

  it('a lure never makes a squishy appear where chance said no', () => {
    const sparse = data({
      tables: LURE_TABLES,
      species: lureData.species,
      rules: { ...RULES, chance: 35 },
    });
    let empty = 0;
    for (let q = 0; q < 120; q += 1) {
      const input = {
        seed: deriveSeed('map-seed', 'spawn', q, 0, window('2026-10-02').id),
        terrain: 'meadow',
        window: window('2026-10-02'),
      };
      const plain = resolveWildSpawn(input, sparse);
      if (plain === null) empty += 1;
      expect(resolveWildSpawn({ ...input, lure: true }, sparse) === null).toBe(plain === null);
    }
    expect(empty).toBeGreaterThan(10);
  });

  it('seasonal tables are in the lure’s pool only in season', () => {
    const commons = pairs('pumpkin', '2026-10-20').filter((p) => p.plain?.speciesId === 'c1');
    expect(commons.length).toBeGreaterThan(5);
    for (const { lured } of commons) {
      expect(lured).toMatchObject({ speciesId: 'halloween-u', lured: true });
    }
    for (const { plain, lured } of pairs('pumpkin', '2026-12-20')) expect(lured).toEqual(plain);
  });
});
