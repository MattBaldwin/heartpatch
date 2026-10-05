import { findAvoidedWords, RECIPES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { BEFRIEND_NUDGE, charmButton, HEART_CHARM, noCharmsLine } from './heart-charm.js';

describe('the Heart Charm button', () => {
  it('shows how many charms are in the bag', () => {
    expect(charmButton(2)).toEqual({ label: 'Use Heart Charm (2)', empty: false });
    expect(charmButton(1)).toEqual({ label: 'Use Heart Charm (1)', empty: false });
  });

  it('stays visible but empty at 0', () => {
    expect(charmButton(0)).toEqual({ label: 'Use Heart Charm (0)', empty: true });
  });

  it('is usable while the count is still loading (the server has the final say)', () => {
    expect(charmButton(null)).toEqual({ label: 'Use Heart Charm', empty: false });
  });
});

describe('noCharmsLine', () => {
  it('reads the real recipe', () => {
    const recipe = RECIPES.find((r) => r.output.resource === HEART_CHARM);
    expect(recipe).toBeDefined();
    // Today: 2 Timber + 1 Treats, said as "1 Treat".
    expect(noCharmsLine()).toBe('No Heart Charms! Craft one from 2 Timber + 1 Treat in your Bag.');
  });

  it('is kid-readable', () => {
    for (const line of [noCharmsLine(), BEFRIEND_NUDGE]) {
      expect(findAvoidedWords(line)).toEqual([]);
      expect(line.split(' ').length).toBeLessThanOrEqual(14);
    }
  });
});
