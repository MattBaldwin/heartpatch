import { describe, expect, it } from 'vitest';
import { CellarRulesSchema } from '../../schemas/data/cellar.js';
import { COMMUNITY_RULES } from '../communities.js';
import { EXPLORE_RULES } from '../explore.js';
import { GAME_DATA } from '../index.js';
import { CELLAR_RULES } from './cellar.js';

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
