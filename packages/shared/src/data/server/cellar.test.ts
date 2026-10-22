import { describe, expect, it } from 'vitest';
import { CellarRulesSchema } from '../../schemas/data/cellar.js';
import { COMMUNITY_RULES } from '../communities.js';
import { EXPLORE_RULES } from '../explore.js';
import { GAME_DATA } from '../index.js';
import { CLOTHING_BY_ID } from '../clothing.js';
import { CELLAR_RULES } from './cellar.js';
import { CLOTHING_DROPS } from './clothing-drops.js';
import { REKINDLED_DROPS } from './hollowed-finds.js';
import { TRICK_OR_TREAT_PRIZES } from './trick-or-treat-prizes.js';

describe('the key hunt and cellar rules (#306 PR 2c)', () => {
  it('are valid', () => {
    expect(CellarRulesSchema.safeParse(CELLAR_RULES).success).toBe(true);
  });

  it('keep the key range out of the public game data (rule 6)', () => {
    expect(JSON.stringify(GAME_DATA)).not.toContain('keyFromVillage');
    expect(JSON.stringify(GAME_DATA)).not.toContain('rareFindMultiplier');
  });

  it('give the cellar hands-only spots a kid can always search', () => {
    const kinds = new Map(EXPLORE_RULES.spotKinds.map((k) => [k.id, k]));
    for (const { kind } of COMMUNITY_RULES.cellar.kinds) {
      expect(kinds.get(kind)?.tool).toBeNull();
    }
    expect(EXPLORE_RULES.terrains.map((t) => t.terrain)).toContain(COMMUNITY_RULES.cellar.terrain);
  });
});

describe('the big chest (#306, owner decision of 2026-10-22)', () => {
  const { bigChest } = CELLAR_RULES;
  const keepsakes = Object.values(bigChest.keepsakes);

  it('holds a different keepsake for every kind of Hollow', () => {
    expect(Object.keys(bigChest.keepsakes).sort()).toEqual(
      COMMUNITY_RULES.kinds.map((k) => k.id).sort(),
    );
    expect(new Set(keepsakes).size).toBe(keepsakes.length);
  });

  it('gives found, kept clothing from the catalog', () => {
    for (const id of keepsakes) {
      const item = CLOTHING_BY_ID.get(id);
      expect(item, id).toBeDefined();
      expect(item!.sources).toEqual(['found']);
      expect(item!.tradable).toBe(false);
      expect(item!.season).toBeUndefined();
    }
  });

  it('is the only place a keepsake turns up', () => {
    const elsewhere = JSON.stringify([CLOTHING_DROPS, REKINDLED_DROPS, TRICK_OR_TREAT_PRIZES]);
    for (const id of keepsakes) expect(elsewhere).not.toContain(id);
  });

  it('gives a big pile of Heartdust and Glimmer', () => {
    expect(bigChest.items['heartdust']).toBeGreaterThan(1);
    expect(bigChest.items['glimmer']).toBeGreaterThan(1);
  });

  it('keeps which Hollow holds which keepsake out of the public game data (rule 6)', () => {
    expect(JSON.stringify(GAME_DATA)).not.toContain('keepsakes');
    expect(JSON.stringify(GAME_DATA)).not.toContain('afterSmall');
  });
});
