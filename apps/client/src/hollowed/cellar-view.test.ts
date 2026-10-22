import { BIG_CHEST_KIND, type ExploreTileResponse } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { CELLAR_TERRAIN, CHEST_KIND, cellarShown, isChest } from './cellar-look.js';
import {
  CELLAR_TEXT,
  cardDelayMs,
  chestAction,
  chestCardTitle,
  chestPlayText,
  chestsLine,
  keepsakeLine,
} from './cellar-view.js';

const spot = (index: number, kind: string, done = false) => ({
  index,
  kind,
  tool: null,
  x: 0,
  z: 0.5,
  done,
});

describe('the cellar as it is shown (#306)', () => {
  const view = {
    q: 1,
    r: 2,
    terrain: 'hills',
    spots: [spot(0, 'rock'), spot(1, 'glow-mushrooms', true), spot(2, BIG_CHEST_KIND)],
  } as unknown as ExploreTileResponse;

  it('is the stone vault, its small chests one kind, indices and places kept', () => {
    const shown = cellarShown(view);
    expect(shown.terrain).toBe(CELLAR_TERRAIN);
    expect(shown.spots.map((s) => [s.index, s.kind, s.done])).toEqual([
      [0, CHEST_KIND, false],
      [1, CHEST_KIND, true],
      [2, BIG_CHEST_KIND, false],
    ]);
    expect(shown.q).toBe(1);
    expect(view.terrain).toBe('hills'); // the server's view isn't changed
  });

  it('knows a chest from any other spot', () => {
    expect(isChest(spot(0, CHEST_KIND))).toBe(true);
    expect(isChest(spot(0, BIG_CHEST_KIND))).toBe(true);
    expect(isChest(spot(0, 'rock'))).toBe(false);
  });
});

describe('the cellar words (#306)', () => {
  it('counts chests open, then cheers when every one is', () => {
    expect(chestsLine({ searched: 2, total: 7 })).toBe('2 of 7 chests open 🗝️');
    expect(chestsLine({ searched: 7, total: 7 })).toBe('Every chest is open! ✨');
  });

  it('opens a chest with a hold, the big one with a crown', () => {
    expect(chestAction(spot(0, CHEST_KIND))).toEqual({
      icon: '🗝️',
      label: 'Open',
      interaction: 'lift',
    });
    expect(chestAction(spot(3, BIG_CHEST_KIND)).icon).toBe('👑');
    expect(chestPlayText(spot(0, CHEST_KIND)).hint).toBe(CELLAR_TEXT.hint);
  });

  it('names the big chest’s card, and says why a keepsake is missing', () => {
    expect(chestCardTitle(spot(3, BIG_CHEST_KIND))).toBe('The big chest! 👑');
    expect(chestCardTitle(spot(0, CHEST_KIND))).toBe('Treasure! 🎁');
    expect(keepsakeLine({ clothing: 'lamplighters-crown' })).toBe(CELLAR_TEXT.keepsake);
    expect(keepsakeLine({ clothing: null })).toBe(CELLAR_TEXT.keepsakeOwned);
  });

  it('waits for the big chest’s moment before its card, a beat for a small one', () => {
    expect(cardDelayMs(spot(3, BIG_CHEST_KIND))).toBeGreaterThan(cardDelayMs(spot(0, CHEST_KIND)));
    expect(cardDelayMs(spot(0, CHEST_KIND))).toBeGreaterThan(0);
    expect(cardDelayMs(spot(0, 'rock'))).toBe(0);
  });

  it('never says village or community to a kid', () => {
    const words = JSON.stringify(CELLAR_TEXT).toLowerCase();
    expect(words).not.toMatch(/village|community/);
  });
});
