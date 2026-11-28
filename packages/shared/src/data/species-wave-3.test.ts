import { describe, expect, it } from 'vitest';
import { deriveSeed } from '../rng/index.js';
import { PatchTypeSchema } from '../patch-types/patch-type.js';
import { PartSchema } from '../schemas/data/visuals.js';
import { resolveWildSpawn, spawnTablesFor } from '../spawns/resolve.js';
import { spawnWindowAt } from '../spawns/window.js';
import { scanPlayerFacingText } from './avoided-words.js';
import { GROWTH_RULES } from './care.js';
import { SEASONS } from './seasons.js';
import { GUARDIAN_RULES } from './server/guardian-rules.js';
import { SECRET_SPECIES } from './server/secret-species.js';
import { SPAWN_RULES } from './server/spawn-rules.js';
import { SPAWN_TABLES } from './server/spawn-tables.js';
import { SPECIES } from './species.js';
import { WAVE_3_SPECIES } from './species-wave-3.js';
import { TERRAINS } from './terrains.js';
import { PARTS } from './visuals.js';

/*
 * Wave 3: the Clockwork Isle tech squishies (#874 C6). Schema, move, part
 * and art-rule checks live in `checkGameData`, and the roster's evolution
 * checks in `species.test.ts`; these pin the wave's shape and that both
 * kinds live only on a Clockwork Isle.
 */

const total = (s: (typeof WAVE_3_SPECIES)[number]) =>
  s.baseStats.hp + s.baseStats.attack + s.baseStats.defense + s.baseStats.speed;
const byId = new Map(SPECIES.map((s) => [s.id, s]));
const waveIds = new Set(WAVE_3_SPECIES.map((s) => s.id));
const evolvedInto = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
const KINDS = WAVE_3_SPECIES.filter((s) => !evolvedInto.has(s.id));
const clockwork = SPAWN_TABLES.filter((t) => t.id.startsWith('clockwork-'));
const allSpecies = new Map([...SPECIES, ...SECRET_SPECIES].map((s) => [s.id, s]));

describe('wave 3: Clockwork Isle tech squishies (#874)', () => {
  it('is Gearbit and Bulbun, both common, with the planned element and feeling', () => {
    expect(KINDS.map((s) => [s.name, s.element, s.feeling, s.rarity])).toEqual([
      ['Gearbit', 'spark', 'joy', 'common'],
      ['Bulbun', 'light', 'cozy', 'common'],
    ]);
    for (const s of WAVE_3_SPECIES) expect(SPECIES, s.id).toContain(s);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
  });

  it('grows each kind into its kid: Cogwhirl and Lanternbun', () => {
    expect(KINDS.map((s) => s.evolutions.map((e) => byId.get(e.into)?.name))).toEqual([
      ['Cogwhirl'],
      ['Lanternbun'],
    ]);
    for (const kind of KINDS) {
      const kid = byId.get(kind.evolutions[0]!.into)!;
      expect(waveIds, kid.id).toContain(kid.id);
      expect(kid.rarity, kid.id).toBe(kind.rarity);
      // TUNE: a kid is about ×1.18 its kind (#443).
      expect(total(kid) / total(kind), kid.id).toBeGreaterThan(1.15);
      expect(total(kid) / total(kind), kid.id).toBeLessThan(1.21);
      // A Wave 2 teen joins after the kid later; for now the kid is final.
      expect(kid.evolutions, kid.id).toEqual([]);
    }
  });

  it('keeps stat totals inside the common band (species.ts)', () => {
    for (const s of KINDS) {
      expect(total(s), s.id).toBeGreaterThanOrEqual(195);
      expect(total(s), s.id).toBeLessThanOrEqual(215);
    }
  });

  it('uses no avoided words in names or descriptions', () => {
    expect(scanPlayerFacingText(WAVE_3_SPECIES, 'WAVE_3_SPECIES')).toEqual([]);
  });

  it('is everyday content that never guards a tile', () => {
    const guarding = new Set(GUARDIAN_RULES.tables.flatMap((t) => t.entries.map((e) => e.species)));
    for (const s of WAVE_3_SPECIES) {
      expect(s.season, s.id).toBeUndefined();
      expect(guarding, s.id).not.toContain(s.id);
    }
  });

  // DECISIONS "Supervisor 55" answer 12: the frames' scarves are a Wardrobe item.
  it('wears no scarf: it is a Wardrobe accessory, not part of the look', () => {
    for (const s of WAVE_3_SPECIES) {
      expect(
        s.visual.parts.filter((p) => p.includes('scarf')),
        s.id,
      ).toEqual([]);
    }
  });

  it('builds the M4 tinker parts as valid registry parts, each worn', () => {
    for (const id of ['gear-ears', 'windup-key', 'cog-crown', 'bulb-nose']) {
      const part = PARTS.find((p) => p.id === id);
      expect(part, id).toBeDefined();
      expect(PartSchema.safeParse(part).success, id).toBe(true);
      expect(
        WAVE_3_SPECIES.some((s) => s.visual.parts.includes(id)),
        id,
      ).toBe(true);
    }
    expect(byId.get('gearbit')!.visual.parts).toEqual(
      expect.arrayContaining(['gear-ears', 'windup-key']),
    );
    expect(byId.get('bulbun')!.visual.parts).toContain('bulb-nose');
  });

  it('spawns only in Clockwork tables, which name only real terrains and the isle', () => {
    const terrains = new Set(TERRAINS.map((t) => t.id));
    expect(clockwork.length).toBeGreaterThan(0);
    for (const t of clockwork) {
      expect(t.patchTypes, t.id).toEqual(['clockwork-isle']);
      for (const p of t.patchTypes!) expect(PatchTypeSchema.options, t.id).toContain(p);
      for (const terrain of t.terrains) expect(terrains, `${t.id}: ${terrain}`).toContain(terrain);
      for (const e of t.entries) expect(waveIds, `${t.id}: ${e.species}`).toContain(e.species);
    }
    // No other table lists a wave-3 squishy.
    for (const t of SPAWN_TABLES.filter((t) => !t.id.startsWith('clockwork-'))) {
      for (const e of t.entries) expect(waveIds, `${t.id}: ${e.species}`).not.toContain(e.species);
    }
  });

  it('finds Gearbit on meadows and hills every day, and Bulbun in forest and on the coast after dark', () => {
    const where = (id: string) =>
      clockwork
        .filter((t) => t.entries.some((e) => e.species === id))
        .map((t) => ({ terrains: [...t.terrains].sort(), timeOfDay: t.timeOfDay }));
    expect(where('gearbit')).toEqual([{ terrains: ['hills', 'meadow'], timeOfDay: undefined }]);
    expect(where('bulbun')).toEqual([
      { terrains: ['coast', 'forest'], timeOfDay: 'dusk' },
      { terrains: ['coast', 'forest'], timeOfDay: 'night' },
    ]);
  });

  describe('the patch-type filter (spawnTablesFor)', () => {
    const rules = { ...SPAWN_RULES, chance: 100 }; // a forced roll: someone on every tile
    const data = (patchType: 'cozy' | 'wild-isle' | 'clockwork-isle', chance = rules.chance) => ({
      tables: spawnTablesFor(SPAWN_TABLES, patchType),
      species: allSpecies,
      seasons: SEASONS,
      rules: { ...rules, chance },
      maxLevel: GROWTH_RULES.maxLevel,
    });
    const windows = {
      day: spawnWindowAt({ date: '2026-12-12', hour: 12 }, SPAWN_RULES.windowHours),
      dusk: spawnWindowAt({ date: '2026-12-12', hour: 18 }, SPAWN_RULES.windowHours),
      night: spawnWindowAt({ date: '2026-12-12', hour: 22 }, SPAWN_RULES.windowHours),
    };
    const roll = (
      patchType: 'cozy' | 'wild-isle' | 'clockwork-isle',
      terrain: string,
      when: keyof typeof windows,
      chance = rules.chance,
    ) =>
      Array.from({ length: 200 }, (_, q) => {
        const window = windows[when];
        return resolveWildSpawn(
          { seed: deriveSeed('map', 'spawn', q, 0, window.id), terrain, window },
          data(patchType, chance),
        )?.speciesId;
      });

    it('keeps every table without patch types, and drops other types’ tables', () => {
      expect(spawnTablesFor(SPAWN_TABLES, 'cozy')).toEqual(
        SPAWN_TABLES.filter((t) => t.patchTypes === undefined),
      );
      expect(spawnTablesFor(SPAWN_TABLES, 'clockwork-isle')).toEqual(SPAWN_TABLES);
    });

    it('never rolls Gearbit or Bulbun on a Cozy patch or a Wild Isle', () => {
      for (const patchType of ['cozy', 'wild-isle'] as const) {
        for (const terrain of ['meadow', 'hills', 'forest', 'coast']) {
          for (const when of ['day', 'dusk', 'night'] as const) {
            const found = roll(patchType, terrain, when);
            expect(found.filter((id) => id !== undefined && waveIds.has(id))).toEqual([]);
          }
        }
      }
    });

    it('rolls them on a Clockwork Isle, on their own terrain and time', () => {
      expect(roll('clockwork-isle', 'meadow', 'day')).toContain('gearbit');
      expect(roll('clockwork-isle', 'hills', 'night')).toContain('gearbit');
      expect(roll('clockwork-isle', 'forest', 'dusk')).toContain('bulbun');
      expect(roll('clockwork-isle', 'coast', 'night')).toContain('bulbun');
      expect(roll('clockwork-isle', 'forest', 'day')).not.toContain('bulbun');
    });

    // Rule: leaving tables out never moves which tiles have someone.
    it('leaves which tiles have someone the same on every patch type', () => {
      const has = (p: 'cozy' | 'clockwork-isle') =>
        roll(p, 'meadow', 'day', SPAWN_RULES.chance).map((id) => id !== undefined);
      expect(has('cozy')).toContain(false);
      expect(has('cozy')).toEqual(has('clockwork-isle'));
    });
  });
});
