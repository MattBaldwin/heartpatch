import { describe, expect, it } from 'vitest';
import { itemEffects } from '../home/item-effects.js';
import { recipeBookPages } from '../recipe-book/index.js';
import { checkClearingRules, clearToolFor } from '../schemas/data/clearing.js';
import { isAvailableRecipe } from '../schemas/data/recipes.js';
import { CLEARING_RULES } from './clearing.js';
import { GAME_DATA } from './index.js';

describe('CLEARING_RULES (#242)', () => {
  it('names real terrains, a tool row for each tool a terrain needs, and a bag item and recipe for each tool', () => {
    expect(checkClearingRules(CLEARING_RULES, GAME_DATA)).toEqual([]);
  });

  it('clears meadows, forests, hills and mountains, and nothing else (owner Q5)', () => {
    expect(clearToolFor('forest', CLEARING_RULES)).toBe('axe');
    expect(clearToolFor('mountains', CLEARING_RULES)).toBe('pickaxe');
    expect(clearToolFor('meadow', CLEARING_RULES)).toBe('spade');
    expect(clearToolFor('hills', CLEARING_RULES)).toBe('spade');
    for (const terrain of [
      'lake',
      'junipers-gap',
      'old-forest',
      'pumpkin-fields',
      'trading-post',
      'clearing',
    ]) {
      expect(clearToolFor(terrain, CLEARING_RULES)).toBeNull();
    }
  });

  it('wears every tool out after a few clears (owner Q4) and keeps it with its Keeper', () => {
    expect(CLEARING_RULES.tools.map((t) => t.id).sort()).toEqual(['axe', 'pickaxe', 'spade']);
    for (const tool of CLEARING_RULES.tools) {
      expect(tool.uses).toBeGreaterThan(0);
      expect(GAME_DATA.resources.find((r) => r.clearTool === tool.id)?.tradable).toBe(false);
      expect(GAME_DATA.recipes.find((r) => r.output.resource === tool.id)?.output.quantity).toBe(
        tool.uses,
      );
    }
  });

  it('refuses a terrain no map places, a missing tool row and a terrain listed twice', () => {
    const broken = {
      ...CLEARING_RULES,
      tools: CLEARING_RULES.tools.filter((t) => t.id !== 'spade'),
      terrains: [
        ...CLEARING_RULES.terrains,
        { terrain: 'junipers-gap', tool: 'axe' },
        { terrain: 'forest', tool: 'axe' },
      ],
    };
    expect(checkClearingRules(broken, GAME_DATA)).toEqual([
      'terrains[2]: no tool row for "spade"',
      'terrains[3]: no tool row for "spade"',
      `terrains[4]: "junipers-gap" can't be cleared`,
      'terrains[5]: "forest" is listed twice',
    ]);
  });

  it('puts the tool recipes in the game with the clear sheet (#295 PR 3)', () => {
    for (const tool of CLEARING_RULES.tools) {
      const recipe = GAME_DATA.recipes.find((r) => r.output.resource === tool.id);
      expect(recipe && isAvailableRecipe(recipe)).toBe(true);
      expect(recipeBookPages().some((p) => p.key === `recipe:${recipe?.id ?? ''}`)).toBe(true);
    }
    // Timber says it goes into an Axe now.
    const into = itemEffects('timber').flatMap((e) => (e.kind === 'recipes' ? e.recipes : []));
    expect(into).toContain('axe');
  });
});
