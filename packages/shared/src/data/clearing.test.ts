import { describe, expect, it } from 'vitest';
import { checkClearingRules, clearToolFor } from '../schemas/data/clearing.js';
import { CLEARING_RULES } from './clearing.js';
import { GAME_DATA } from './index.js';

describe('CLEARING_RULES (#242)', () => {
  it('names real terrains and a tool row for each tool a terrain needs', () => {
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

  it('wears every tool out after a few clears (owner Q4)', () => {
    expect(CLEARING_RULES.tools.map((t) => t.id).sort()).toEqual(['axe', 'pickaxe', 'spade']);
    for (const tool of CLEARING_RULES.tools) expect(tool.uses).toBeGreaterThan(0);
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
});
