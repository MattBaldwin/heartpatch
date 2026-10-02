import { findAvoidedWords, GAME_DATA, type Craft } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { bagItems, bagRecipes, describeItems } from './bag-view.js';
import { FALLBACK_ICON, itemIcon } from './item-icons.js';

const craft: Craft = {
  id: '0190a8c4-0000-7000-8000-0000000000bb',
  recipeId: 'heart-charm',
  items: { 'heart-charm': 1 },
  startedAt: '2026-10-02T12:00:00Z',
  readyAt: '2026-10-02T12:01:00Z',
};

const stateOf = (rows: ReturnType<typeof bagRecipes>, id: string) =>
  rows.find((r) => r.recipe.id === id)?.state;

describe('bag', () => {
  it('lists what you have, in the resource order, with pictures', () => {
    expect(bagItems({ 'heart-charm': 2, timber: 5, stone: 0 })).toEqual([
      { id: 'timber', name: 'Timber', icon: itemIcon('timber'), count: 5 },
      { id: 'heart-charm', name: 'Heart Charm', icon: itemIcon('heart-charm'), count: 2 },
    ]);
  });

  it('has a picture for every item in the game data', () => {
    for (const r of GAME_DATA.resources) expect(itemIcon(r.id), r.id).not.toBe(FALLBACK_ICON);
  });

  it('says what a gather or craft gives', () => {
    expect(describeItems({ emberwood: 2, 'witch-dust': 1 })).toBe(
      `+2 ${itemIcon('emberwood')} Emberwood, +1 ${itemIcon('witch-dust')} Witch Dust`,
    );
  });

  it('knows which recipes you can make right now', () => {
    const rows = bagRecipes({ timber: 2, treats: 1 }, [], ['halloween']);
    expect(stateOf(rows, 'heart-charm')).toEqual({ kind: 'ready' });
    expect(stateOf(rows, 'jack-o-lantern-hearthfire')).toMatchObject({ kind: 'short' });
    expect(stateOf(bagRecipes({ timber: 1 }, [], []), 'heart-charm')).toEqual({
      kind: 'short',
      note: 'Need 1 more Timber, 1 more Treats.',
    });
    expect(stateOf(bagRecipes({ timber: 9, treats: 9 }, [craft], []), 'heart-charm')).toEqual({
      kind: 'busy',
    });
    expect(stateOf(bagRecipes({}, [], ['christmas']), 'jack-o-lantern-hearthfire')).toEqual({
      kind: 'sleeping',
      note: 'Only around Halloween.',
    });
  });

  it('keeps every line kid-friendly (style guide §9)', () => {
    const lines = [
      ...bagRecipes({}, [], []).flatMap((r) =>
        'note' in r.state ? [r.state.note, r.recipe.name, r.recipe.description] : [r.recipe.name],
      ),
      ...GAME_DATA.resources.flatMap((r) => [r.name, r.description]),
    ];
    for (const line of lines) expect(findAvoidedWords(line), line).toEqual([]);
  });
});
