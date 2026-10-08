import { findAvoidedWords, RECIPES, type PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  BEFRIEND_NUDGE,
  charmButton,
  HEART_CHARM,
  joinedLine,
  newFriends,
  noCharmsLine,
} from './heart-charm.js';

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

describe('who joined the patch (#279)', () => {
  /** Just what `newFriends` reads: the other side's team and how it ended. */
  const ended = (
    squishies: { id: string; befriended?: true }[],
    active: number,
    phase: PlayerBattle['view']['phase'],
  ) =>
    ({
      mySide: 'a',
      view: { phase, sides: { b: { squishies, active } } },
    }) as unknown as PlayerBattle;
  const over = (reason: 'captured' | 'tuckered-out', winner: 'a' | 'b' = 'a') =>
    ({ type: 'over', result: { winner, reason, contentHash: 'x', turns: 2, xp: [] } }) as const;

  it('is the wild squishy that said yes', () => {
    const b = ended([{ id: 'wild' }], 0, over('captured'));
    expect(newFriends(b).map((s) => s.id)).toEqual(['wild']);
  });

  it('is every guardian befriended, the last one still out', () => {
    const b = ended([{ id: 'g1', befriended: true }, { id: 'g2' }], 1, over('captured'));
    expect(newFriends(b).map((s) => s.id)).toEqual(['g1', 'g2']);
  });

  it('keeps the ones that came along before a knockout win, or a loss', () => {
    const team = [{ id: 'g1', befriended: true as const }, { id: 'g2' }];
    expect(newFriends(ended(team, 1, over('tuckered-out'))).map((s) => s.id)).toEqual(['g1']);
    expect(newFriends(ended(team, 1, over('tuckered-out', 'b'))).map((s) => s.id)).toEqual(['g1']);
    expect(newFriends(ended(team, 1, { type: 'turn' })).map((s) => s.id)).toEqual(['g1']);
  });

  it('is nobody after a plain win', () => {
    expect(newFriends(ended([{ id: 'wild' }], 0, over('tuckered-out')))).toEqual([]);
  });

  it('says who in one short line', () => {
    expect(joinedLine(['Moonpuff'])).toBe('Moonpuff joined your patch!');
    expect(joinedLine(['Moonpuff', 'Snoozlet'])).toBe('Moonpuff and Snoozlet joined your patch!');
    expect(joinedLine(['A', 'B', 'C'])).toBe('A, B and C joined your patch!');
    expect(joinedLine([])).toBe('Your new squishy joined your patch!');
    expect(findAvoidedWords(joinedLine(['Moonpuff', 'Snoozlet']))).toEqual([]);
  });
});
