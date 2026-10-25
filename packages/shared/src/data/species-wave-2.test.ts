import { describe, expect, it } from 'vitest';
import { GUARDIAN_RULES } from './server/guardian-rules.js';
import { SPAWN_TABLES } from './server/spawn-tables.js';
import { SPECIES } from './species.js';
import { WAVE_2_SPECIES } from './species-wave-2.js';
import { PARTS } from './visuals.js';
import { PartSchema } from '../schemas/data/visuals.js';

/*
 * Wave 2 of the 500-squishy plan (#382). Schema, move, part and art-rule
 * checks live in `checkGameData`; these pin the wave's shape: the rarity mix,
 * the stat bands, and that every kind has a place and time to be found. A
 * kind's kid and teen (#443) are evolved forms, held to the roster's
 * evolution checks in `species.test.ts`; the "kinds" here are the first forms.
 */

const total = (s: (typeof WAVE_2_SPECIES)[number]) =>
  s.baseStats.hp + s.baseStats.attack + s.baseStats.defense + s.baseStats.speed;
const evolvedInto = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
/** The 9 kinds: each wave-2 line's first form. */
const KINDS = WAVE_2_SPECIES.filter((s) => !evolvedInto.has(s.id));
const kindIds = new Set(KINDS.map((s) => s.id));
const tables = SPAWN_TABLES.filter((t) => t.id.startsWith('wave-2-'));

describe('wave 2 (#382)', () => {
  it('is 9 kinds: 6 common, 2 uncommon, 1 rare, all in the public roster', () => {
    expect(KINDS).toHaveLength(9);
    const count = (r: string) => KINDS.filter((s) => s.rarity === r).length;
    expect([count('common'), count('uncommon'), count('rare')]).toEqual([6, 2, 1]);
    for (const s of WAVE_2_SPECIES) expect(SPECIES, s.id).toContain(s);
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

  // #443: baby → kid → one teen. No form of a wave-2 line guards a tile.
  it('is everyday content with no guardian duty, and each line is a kid and one teen', () => {
    const guarding = new Set(GUARDIAN_RULES.tables.flatMap((t) => t.entries.map((e) => e.species)));
    for (const s of WAVE_2_SPECIES) {
      expect(s.season, s.id).toBeUndefined();
      expect(s.evolutions.length, s.id).toBeLessThanOrEqual(1);
      expect(guarding, s.id).not.toContain(s.id);
      for (const e of s.evolutions) expect(kindIds, e.into).not.toContain(e.into);
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

  it('spawns only in its own wave-2 tables, and every kind has a home', () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.season, t.id).toBeUndefined();
      for (const e of t.entries) expect(kindIds, `${t.id}: ${e.species}`).toContain(e.species);
    }
    for (const s of KINDS) {
      const homes = tables.filter((t) => t.entries.some((e) => e.species === s.id));
      expect(homes.length, s.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('uses all three levers: terrain, daylight and night', () => {
    const times = new Set(tables.map((t) => t.timeOfDay));
    expect([...times].sort()).toEqual(['day', 'dusk', 'night', undefined].sort());
    const wild = ['forest', 'hills', 'lake', 'meadow', 'mountains', 'old-forest', 'pumpkin-fields'];
    const covered = new Set(tables.flatMap((t) => t.terrains));
    for (const terrain of covered) expect(wild, terrain).toContain(terrain);
    expect(covered.size).toBeGreaterThanOrEqual(6);
    // Cloudlamb is a daytime kind; Glimbug and Lampfin only come out after dark.
    const when = (id: string) =>
      new Set(
        tables.filter((t) => t.entries.some((e) => e.species === id)).map((t) => t.timeOfDay),
      );
    expect([...when('cloudlamb')]).toEqual(['day']);
    expect([...when('lampfin')]).toEqual(['night']);
    expect(when('glimbug').has(undefined)).toBe(false);
  });

  it('weighs rarer kinds lighter and keeps every kind out of the Gap', () => {
    const byId = new Map(KINDS.map((s) => [s.id, s]));
    const weight: Partial<Record<string, number>> = { common: 4, uncommon: 2, rare: 1 };
    for (const t of tables) {
      expect(t.terrains, t.id).not.toContain('junipers-gap');
      for (const e of t.entries) {
        expect(e.weight, `${t.id}: ${e.species}`).toBeLessThanOrEqual(
          weight[byId.get(e.species)!.rarity] ?? 0,
        );
      }
    }
  });

  it('is built only from parts already in the registry, and stays inside the mobile part budget', () => {
    const instances = (parts: readonly string[]) =>
      parts.reduce((sum, id) => {
        const part = PARTS.find((p) => p.id === id);
        expect(part, id).toBeDefined();
        const { layout } = part!;
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
    // TUNE: the heaviest launch kind is 27 part instances; wave 2 stays within 32.
    for (const s of WAVE_2_SPECIES) expect(instances(s.visual.parts), s.id).toBeLessThanOrEqual(32);
  });

  it('adds ten parts, each valid and worn by at least one wave-2 form', () => {
    const NEW_PARTS = [
      'tusks',
      'mud-puddle',
      'tree-stump',
      'slide-trail',
      'lure-beads',
      'shell-gleam',
      'puff-wings',
      'curl-tail',
      'chest-bib',
      'tree-top',
    ];
    for (const id of NEW_PARTS) {
      const part = PARTS.find((p) => p.id === id);
      expect(part, id).toBeDefined();
      expect(PartSchema.safeParse(part).success, id).toBe(true);
      expect(
        WAVE_2_SPECIES.some((s) => s.visual.parts.includes(id)),
        `${id} is worn`,
      ).toBe(true);
    }
  });
});
