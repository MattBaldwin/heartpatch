import { describe, expect, it } from 'vitest';
import { PARTS } from './visuals.js';
import { GUARDIAN_RULES } from './server/guardian-rules.js';
import { SPAWN_TABLES } from './server/spawn-tables.js';
import { SPECIES } from './species.js';
import { WAVE_1_SPECIES } from './species-wave-1.js';

/*
 * Wave 1 of the 500-squishy plan (#382). Schema, move, part and art-rule
 * checks live in `checkGameData`; these pin the wave's shape: the rarity mix,
 * the stat bands, and that every kind has a biome to be found in. A kind's
 * kid and teen (#443) are evolved forms, held to the roster's evolution
 * checks in `species.test.ts`; the "kinds" here are the first forms.
 */

const total = (s: (typeof WAVE_1_SPECIES)[number]) =>
  s.baseStats.hp + s.baseStats.attack + s.baseStats.defense + s.baseStats.speed;
const evolvedInto = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
/** The 8 kinds: each wave-1 line's first form. */
const KINDS = WAVE_1_SPECIES.filter((s) => !evolvedInto.has(s.id));
const wave1Ids = new Set(KINDS.map((s) => s.id));
const tables = SPAWN_TABLES.filter((t) => t.id.startsWith('wave-1-'));

describe('wave 1 (#382)', () => {
  it('is 8 kinds: 4 common, 2 uncommon, 2 rare, all in the public roster', () => {
    expect(KINDS).toHaveLength(8);
    const count = (r: string) => KINDS.filter((s) => s.rarity === r).length;
    expect([count('common'), count('uncommon'), count('rare')]).toEqual([4, 2, 2]);
    for (const s of WAVE_1_SPECIES) expect(SPECIES, s.id).toContain(s);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
  });

  it('keeps stat totals inside the rarity bands (species.ts)', () => {
    const bands: Partial<Record<string, readonly [number, number]>> = {
      common: [195, 215],
      uncommon: [210, 240],
      rare: [225, 245],
    };
    for (const s of KINDS) {
      const band = bands[s.rarity];
      expect(band, `${s.id} is ${s.rarity}`).toBeDefined();
      const [min, max] = band!;
      expect(total(s), s.id).toBeGreaterThanOrEqual(min);
      expect(total(s), s.id).toBeLessThanOrEqual(max);
    }
  });

  // #443: a converted line is baby → kid → one teen (its branch teen comes
  // in Phase 2). No form of a wave-1 line guards a tile.
  it('is everyday content with no guardian duty, and each line has at most one teen', () => {
    const guarding = new Set(GUARDIAN_RULES.tables.flatMap((t) => t.entries.map((e) => e.species)));
    for (const s of WAVE_1_SPECIES) {
      expect(s.season, s.id).toBeUndefined();
      expect(s.evolutions.length, s.id).toBeLessThanOrEqual(1);
      expect(guarding, s.id).not.toContain(s.id);
      for (const e of s.evolutions) expect(wave1Ids, e.into).not.toContain(e.into);
    }
  });

  // #443 §5: like the launch lines, the kid keeps its kind's rarity and the
  // teen is exactly one step up.
  it('makes each teen one rarity above its kind', () => {
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const byId = new Map(SPECIES.map((s) => [s.id, s]));
    for (const kind of KINDS) {
      const kid = byId.get(kind.evolutions[0]!.into)!;
      const teen = byId.get(kid.evolutions[0]!.into)!;
      expect(kid.rarity, kid.id).toBe(kind.rarity);
      expect(order.indexOf(teen.rarity), teen.id).toBe(order.indexOf(kind.rarity) + 1);
    }
  });

  it('spawns only in its biome tables: terrain-tied, any season, any time of day', () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect([t.season, t.timeOfDay], t.id).toEqual([undefined, undefined]);
      for (const e of t.entries) expect(wave1Ids, `${t.id}: ${e.species}`).toContain(e.species);
    }
    for (const s of KINDS) {
      const homes = tables.filter((t) => t.entries.some((e) => e.species === s.id));
      expect(homes.length, s.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('spreads across the wild terrains, with rarer kinds weighed lighter', () => {
    const wild = ['forest', 'hills', 'lake', 'meadow', 'mountains', 'old-forest', 'pumpkin-fields'];
    const covered = new Set(tables.flatMap((t) => t.terrains));
    for (const terrain of covered) expect(wild, terrain).toContain(terrain);
    expect(covered.size).toBeGreaterThanOrEqual(5);
    const byId = new Map(KINDS.map((s) => [s.id, s]));
    const weight: Partial<Record<string, number>> = { common: 4, uncommon: 2, rare: 1 };
    for (const t of tables) {
      for (const e of t.entries) {
        const kind = byId.get(e.species);
        expect(kind, `${t.id}: ${e.species} is a wave-1 kind`).toBeDefined();
        expect(e.weight, `${t.id}: ${e.species}`).toBeLessThanOrEqual(weight[kind!.rarity] ?? 0);
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
      'handle-arc': 'tail',
      'moth-wings': 'wings',
    } as const;
    const used = new Set(WAVE_1_SPECIES.flatMap((s) => s.visual.parts));
    for (const [id, slot] of Object.entries(wanted)) {
      const part = PARTS.find((p) => p.id === id);
      expect(part, id).toBeDefined();
      expect(part?.slot, id).toBe(slot);
      expect(['ellipsoid', 'capsule', 'cone', 'teardrop', 'arc'], id).toContain(part?.shape);
      expect(used, id).toContain(id);
    }
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
