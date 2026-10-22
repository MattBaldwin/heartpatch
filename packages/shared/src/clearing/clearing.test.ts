import { describe, expect, it } from 'vitest';
import { CLEARING_RULES } from '../data/clearing.js';
import { JOB_RULES } from '../data/jobs.js';
import { RECIPES } from '../data/recipes.js';
import { RESOURCES } from '../data/resources.js';
import { clearDrop, clearToolMakeable } from './index.js';

const drop = (terrain: string, nodeResource: string | null = null) =>
  clearDrop({ terrain, nodeResource }, RESOURCES, JOB_RULES, CLEARING_RULES);

describe('clearDrop (#242)', () => {
  it('drops nothing seasonal out of its season (#601: Pumpkin Fields clear all year)', () => {
    const at =
      (seasons: string[]) =>
      (terrain: string, node: string | null = null) =>
        clearDrop(
          { terrain, nodeResource: node },
          RESOURCES,
          JOB_RULES,
          CLEARING_RULES,
          new Set(seasons),
        );
    const halloween = at(['halloween']);
    const winter = at([]);
    expect(halloween('pumpkin-fields')).toEqual({ pumpkins: 2 });
    expect(halloween('pumpkin-fields', 'pumpkins')).toEqual({ pumpkins: 2 });
    expect(winter('pumpkin-fields')).toEqual({});
    expect(winter('pumpkin-fields', 'pumpkins')).toEqual({});
    // Year-round land still drops: a lake's Water, Old Forest's Emberwood.
    expect(winter('lake')).not.toEqual({});
    expect(winter('old-forest')).not.toEqual({});
  });

  it("drops one gather of the tile's spot", () => {
    const stone = RESOURCES.find((r) => r.id === 'stone')?.gather?.quantity;
    expect(drop('hills', 'stone')).toEqual({ stone });
    expect(drop('mountains', 'glimmer')).toEqual({ glimmer: 1 });
  });

  it("drops a couple of the land's own yield when there's no spot", () => {
    expect(drop('meadow')).toEqual({ greens: 4 });
    expect(drop('mountains')).toEqual({ ice: 2 });
  });

  it('drops nothing where nothing grows', () => {
    expect(drop('clearing')).toEqual({});
  });
});

describe('clearToolMakeable (#242)', () => {
  it('is true for a tool a recipe in the game makes, and false while its recipe is hidden', () => {
    expect(clearToolMakeable('axe', RECIPES)).toBe(true);
    const hidden = RECIPES.map((r) =>
      r.output.resource === 'axe' ? { ...r, hidden: true as const } : r,
    );
    expect(clearToolMakeable('axe', hidden)).toBe(false);
    expect(clearToolMakeable('no-such-tool', RECIPES)).toBe(false);
  });
});
