import { describe, expect, it } from 'vitest';
import * as publicEntry from '../index.js';
import { LONG_NIGHT_RULES } from '../data/long-night.js';
import { LONG_NIGHT_SECRETS } from '../data/server/long-night.js';
import { SECRET_SPECIES } from '../data/server/secret-species.js';
import { LONG_NIGHT_GAP_TABLE, SPAWN_TABLES } from '../data/server/spawn-tables.js';
import { SPECIES } from '../data/species.js';
import * as serverEntry from '../data/server/index.js';
import { SpawnTableSchema } from '../schemas/data/spawn-tables.js';
import { longNightContentHash, rollGapEncounter } from './gap.js';

const species = new Map([...SPECIES, ...SECRET_SPECIES].map((s) => [s.id, s]));

describe("Juniper's Gap table (#727)", () => {
  it('is a valid spawn table of legendary and secret squishies only', () => {
    expect(SpawnTableSchema.safeParse(LONG_NIGHT_GAP_TABLE).success).toBe(true);
    for (const { species: id } of LONG_NIGHT_GAP_TABLE.entries) {
      expect(['legendary', 'secret'], id).toContain(species.get(id)?.rarity);
    }
  });

  it('stays out of the ordinary spawn roll, and off the client (rule 6)', () => {
    expect(SPAWN_TABLES.some((t) => t.id === LONG_NIGHT_GAP_TABLE.id)).toBe(false);
    for (const name of ['LONG_NIGHT_GAP_TABLE', 'rollGapEncounter', 'longNightContentHash']) {
      expect(name in serverEntry, name).toBe(true);
      expect(name in publicEntry, name).toBe(false);
    }
  });
});

describe('rollGapEncounter (#727)', () => {
  it('rolls the same squishy for the same seed, night and Keeper', () => {
    const roll = (night: string, userId: string) =>
      rollGapEncounter('map-seed', night, userId, LONG_NIGHT_GAP_TABLE);
    expect(roll('2026-10-31', 'u1')).toBe(roll('2026-10-31', 'u1'));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(roll('2026-10-31', `u${String(i)}`));
    // Every Keeper rolls their own: both squishies turn up.
    expect([...seen].sort()).toEqual(LONG_NIGHT_GAP_TABLE.entries.map((e) => e.species).sort());
  });
});

describe('longNightContentHash (#727)', () => {
  it('changes with the rules, the secrets or the Gap table, and not with key order', () => {
    const hash = longNightContentHash(LONG_NIGHT_RULES, LONG_NIGHT_SECRETS, LONG_NIGHT_GAP_TABLE);
    const reordered = Object.fromEntries(
      Object.entries(LONG_NIGHT_RULES).reverse(),
    ) as typeof LONG_NIGHT_RULES;
    expect(longNightContentHash(reordered, LONG_NIGHT_SECRETS, LONG_NIGHT_GAP_TABLE)).toBe(hash);
    expect(
      longNightContentHash(
        { ...LONG_NIGHT_RULES, gapOpenHours: 12 },
        LONG_NIGHT_SECRETS,
        LONG_NIGHT_GAP_TABLE,
      ),
    ).not.toBe(hash);
    expect(
      longNightContentHash(LONG_NIGHT_RULES, { strengthMultiplier: 2 }, LONG_NIGHT_GAP_TABLE),
    ).not.toBe(hash);
    expect(
      longNightContentHash(LONG_NIGHT_RULES, LONG_NIGHT_SECRETS, {
        entries: [{ species: 'heartlet', weight: 1 }],
      }),
    ).not.toBe(hash);
  });
});
