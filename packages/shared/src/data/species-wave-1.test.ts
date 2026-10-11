import { describe, expect, it } from 'vitest';
import { PARTS } from './visuals.js';
import { GUARDIAN_RULES } from './server/guardian-rules.js';
import { SPAWN_TABLES } from './server/spawn-tables.js';
import { SPECIES } from './species.js';
import { WAVE_1_SPECIES } from './species-wave-1.js';

/*
 * Wave 1 of the 500-squishy plan (#382). Schema, move, part and art-rule
 * checks live in `checkGameData`; these pin the wave's shape: the rarity mix,
 * the stat bands, and that every kind has a biome to be found in.
 */

const total = (s: (typeof WAVE_1_SPECIES)[number]) =>
  s.baseStats.hp + s.baseStats.attack + s.baseStats.defense + s.baseStats.speed;
const wave1Ids = new Set(WAVE_1_SPECIES.map((s) => s.id));
const tables = SPAWN_TABLES.filter((t) => t.id.startsWith('wave-1-'));

describe('wave 1 (#382)', () => {
  it('is 30 kinds: 18 common, 9 uncommon, 3 rare, all in the public roster', () => {
    expect(WAVE_1_SPECIES).toHaveLength(30);
    const count = (r: string) => WAVE_1_SPECIES.filter((s) => s.rarity === r).length;
    expect([count('common'), count('uncommon'), count('rare')]).toEqual([18, 9, 3]);
    for (const s of WAVE_1_SPECIES) expect(SPECIES, s.id).toContain(s);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
  });

  it('keeps stat totals inside the rarity bands (species.ts)', () => {
    const bands = { common: [195, 215], uncommon: [210, 240], rare: [225, 245] } as const;
    for (const s of WAVE_1_SPECIES) {
      const [min, max] = bands[s.rarity as keyof typeof bands];
      expect(total(s), s.id).toBeGreaterThanOrEqual(min);
      expect(total(s), s.id).toBeLessThanOrEqual(max);
    }
  });

  it('is everyday, standalone content: no season, no evolutions, no guardian duty', () => {
    const guarding = new Set(GUARDIAN_RULES.tables.flatMap((t) => t.entries.map((e) => e.species)));
    const evolvedInto = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
    for (const s of WAVE_1_SPECIES) {
      expect(s.season, s.id).toBeUndefined();
      expect(s.evolutions, s.id).toEqual([]);
      expect(guarding, s.id).not.toContain(s.id);
      expect(evolvedInto, s.id).not.toContain(s.id);
    }
  });

  it('spawns only in its biome tables: terrain-tied, any season, any time of day', () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect([t.season, t.timeOfDay], t.id).toEqual([undefined, undefined]);
      for (const e of t.entries) expect(wave1Ids, `${t.id}: ${e.species}`).toContain(e.species);
    }
    for (const s of WAVE_1_SPECIES) {
      const homes = tables.filter((t) => t.entries.some((e) => e.species === s.id));
      expect(homes.length, s.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('spreads across every wild terrain, with rarer kinds weighed lighter', () => {
    const covered = new Set(tables.flatMap((t) => t.terrains));
    expect([...covered].sort()).toEqual(
      ['forest', 'hills', 'lake', 'meadow', 'mountains', 'old-forest', 'pumpkin-fields'].sort(),
    );
    const byId = new Map(WAVE_1_SPECIES.map((s) => [s.id, s]));
    const weight = { common: 4, uncommon: 2, rare: 1 } as const;
    for (const t of tables) {
      for (const e of t.entries) {
        const rarity = byId.get(e.species)!.rarity as keyof typeof weight;
        expect(e.weight, `${t.id}: ${e.species}`).toBeLessThanOrEqual(weight[rarity]);
      }
    }
  });

  it('keeps every kind out of the Gap (its own table is the launch roster)', () => {
    for (const t of tables) expect(t.terrains, t.id).not.toContain('junipers-gap');
  });

  it('adds four read-at-a-glance parts, all data on existing shapes, and every one is used', () => {
    const wanted = {
      'eye-bumps': 'horns',
      'shell-dome': 'back',
      'claw-arms': 'arms',
      'lure-lantern': 'crown',
    } as const;
    const used = new Set(WAVE_1_SPECIES.flatMap((s) => s.visual.parts));
    for (const [id, slot] of Object.entries(wanted)) {
      const part = PARTS.find((p) => p.id === id);
      expect(part, id).toBeDefined();
      expect(part?.slot, id).toBe(slot);
      expect(['ellipsoid', 'capsule', 'cone', 'teardrop', 'arc'], id).toContain(part?.shape);
      expect(used, id).toContain(id);
    }
    // The lure is a glowing lantern: only an `accent` part takes the `glow: 'accent'` rule.
    expect(PARTS.find((p) => p.id === 'lure-lantern')?.color).toBe('accent');
  });

  it('keeps every kind inside the mobile part budget (CLAUDE.md rule 8)', () => {
    const instances = (parts: readonly string[]) =>
      parts.reduce((sum, id) => {
        const { layout } = PARTS.find((p) => p.id === id)!;
        return (
          sum +
          (layout.kind === 'single'
            ? 1
            : layout.kind === 'pair'
              ? 2
              : layout.kind === 'quad'
                ? 4
                : layout.count)
        );
      }, 0);
    // TUNE: the heaviest launch kind is 27 part instances; wave 1 stays within 32.
    for (const s of WAVE_1_SPECIES) expect(instances(s.visual.parts), s.id).toBeLessThanOrEqual(32);
  });
});
