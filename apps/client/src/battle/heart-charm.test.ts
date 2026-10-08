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
  /** Just what `newFriends` reads: the kind, the other side's team and how it ended. */
  const ended = (
    squishies: { speciesId: string; befriended?: true }[],
    active: number,
    phase: PlayerBattle['view']['phase'],
    kind: PlayerBattle['kind'] = 'tile',
  ) =>
    ({
      kind,
      mySide: 'a',
      view: { phase, sides: { b: { squishies, active } } },
    }) as unknown as PlayerBattle;
  const over = (
    reason: 'captured' | 'tuckered-out',
    winner: 'a' | 'b' = 'a',
  ): PlayerBattle['view']['phase'] => ({
    type: 'over',
    result: { winner, reason, contentHash: 'x', turns: 2, xp: [] },
  });

  it('is the wild squishy that said yes, as it was', () => {
    const b = ended([{ speciesId: 'hearthbun' }], 0, over('captured'), 'wild');
    expect(newFriends(b)).toEqual(['hearthbun']);
  });

  it('is every guardian befriended, the last one still out', () => {
    const b = ended(
      [{ speciesId: 'fuzzbolt', befriended: true }, { speciesId: 'emberbun' }],
      1,
      over('captured'),
    );
    expect(newFriends(b)).toEqual(['fuzzbolt', 'emberbun']);
  });

  it('names an evolved guardian by the form one step back (owner decision 2026-10-08)', () => {
    // Juniper's Gap: a Hearthbun guardian joins as an Emberbun.
    const b = ended([{ speciesId: 'hearthbun' }], 0, over('captured'));
    expect(newFriends(b)).toEqual(['emberbun']);
  });

  it('keeps the ones that came along before a knockout win, or a loss', () => {
    const team = [{ speciesId: 'fuzzbolt', befriended: true as const }, { speciesId: 'emberbun' }];
    expect(newFriends(ended(team, 1, over('tuckered-out')))).toEqual(['fuzzbolt']);
    expect(newFriends(ended(team, 1, over('tuckered-out', 'b')))).toEqual(['fuzzbolt']);
    expect(newFriends(ended(team, 1, { type: 'turn' }))).toEqual(['fuzzbolt']);
  });

  it('is nobody after a plain win', () => {
    expect(newFriends(ended([{ speciesId: 'fuzzbolt' }], 0, over('tuckered-out')))).toEqual([]);
  });

  it('says who in one short line', () => {
    expect(joinedLine(['Moonpuff'])).toBe('Moonpuff joined your patch!');
    expect(joinedLine(['Moonpuff', 'Snoozlet'])).toBe('Moonpuff and Snoozlet joined your patch!');
    expect(joinedLine(['A', 'B', 'C'])).toBe('A, B and C joined your patch!');
    expect(joinedLine([])).toBe('Your new squishy joined your patch!');
    expect(findAvoidedWords(joinedLine(['Moonpuff', 'Snoozlet']))).toEqual([]);
  });
});
