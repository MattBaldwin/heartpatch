import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng/index.js';
import { RESOURCES } from '../resources.js';
import { LORE_PAGES } from './lore-pages.js';
import { PUZZLE_REWARDS, rollPuzzleReward } from './puzzle-rewards.js';

describe('PUZZLE_REWARDS (#306 PR 2b)', () => {
  it('gives only pages a fixed puzzle finds, and a real fallback', () => {
    for (const id of PUZZLE_REWARDS.lorePages) {
      const page = LORE_PAGES.find((p) => p.id === id);
      expect(page?.trigger.eventType).toBe('explore.puzzled');
      expect(page?.trigger.where).toEqual([{ op: 'equals', field: 'lorePage', value: id }]);
    }
    const items = new Set(RESOURCES.map((r) => r.id));
    for (const id of Object.keys(PUZZLE_REWARDS.fallback)) expect(items.has(id)).toBe(true);
  });
});

describe('rollPuzzleReward (#306 PR 2b)', () => {
  const rng = () => Rng.fromSeed('puzzle-roll');

  it('gives a page not found yet', () => {
    const foundLore = new Set(['the-market-day-tune', 'the-painted-wall']);
    expect(rollPuzzleReward(PUZZLE_REWARDS, { foundLore, recipes: [] }, rng())).toEqual({
      kind: 'lore',
      id: 'keep-the-lanterns-lit',
    });
  });

  it('can give a sealed Rekindled recipe page as well (#306 PR 5)', () => {
    const foundLore = new Set(PUZZLE_REWARDS.lorePages);
    expect(rollPuzzleReward(PUZZLE_REWARDS, { foundLore, recipes: ['heart-tea'] }, rng())).toEqual({
      kind: 'recipe',
      id: 'heart-tea',
    });
  });

  it('gives the fallback once every page is found', () => {
    const foundLore = new Set(PUZZLE_REWARDS.lorePages);
    expect(rollPuzzleReward(PUZZLE_REWARDS, { foundLore, recipes: [] }, rng())).toEqual({
      kind: 'items',
      items: PUZZLE_REWARDS.fallback,
    });
  });

  it('picks among every unfound page', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = rollPuzzleReward(
        PUZZLE_REWARDS,
        { foundLore: new Set(), recipes: [] },
        Rng.fromSeed(`roll-${String(i)}`),
      );
      if (r.kind === 'lore') seen.add(r.id);
    }
    expect(seen.size).toBe(PUZZLE_REWARDS.lorePages.length);
  });
});
