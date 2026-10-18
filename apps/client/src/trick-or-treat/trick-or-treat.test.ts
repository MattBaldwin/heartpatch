import { findAvoidedWords, type TrickOrTreatView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { userId } from '../map/test-view.js';
import { doorLines, doorOf, litHosts, prizeToast, TRICK_TEXT } from './trick-or-treat-text.js';

const ME = userId(1);
const view = (over: Partial<TrickOrTreatView> = {}): TrickOrTreatView => ({
  open: true,
  day: '2026-10-18',
  resetsAt: '2026-10-19T07:00:00.000Z',
  hosts: [
    { userId: userId(2), lit: false, visited: false },
    { userId: userId(3), lit: true, visited: false },
    { userId: userId(4), lit: true, visited: true },
  ],
  ...over,
});
const home = (owner: string | null) => ({ ownerUserId: owner, homeSlot: 1 });

describe('doorOf (#515)', () => {
  it("opens on any tile of a patch-mate's home while trick-or-treat is on", () => {
    expect(doorOf(home(userId(2)), view(), ME)).toEqual({
      kind: 'open',
      host: { userId: userId(2), lit: false, visited: false },
    });
    expect(doorOf(home(userId(4)), view(), ME).kind).toBe('visited');
  });

  it('shows nothing on my own home, land out on the map, an empty plot, or out of season', () => {
    expect(
      doorOf(home(ME), view({ hosts: [{ userId: ME, lit: true, visited: false }] }), ME),
    ).toEqual({ kind: 'none' });
    expect(doorOf({ ownerUserId: userId(2), homeSlot: null }, view(), ME).kind).toBe('none');
    expect(doorOf(home(null), view(), ME).kind).toBe('none');
    expect(doorOf(home(userId(2)), view({ open: false }), ME).kind).toBe('none');
    // Not heard yet, or someone who isn't a host (left the patch).
    expect(doorOf(home(userId(2)), null, ME).kind).toBe('none');
    expect(doorOf(home(userId(9)), view(), ME).kind).toBe('none');
  });
});

describe('doorLines (#515, the approved map screens)', () => {
  it("says every home has treats, a lit one's are extra good, and come back tomorrow once visited", () => {
    const lines = (owner: string) => doorLines(doorOf(home(owner), view(), ME));
    expect(lines(userId(2))).toEqual([{ icon: '🎃', text: 'This home has treats tonight!' }]);
    expect(lines(userId(3))).toEqual([
      { icon: '🎃', text: 'Their lantern is lit. Extra-good treats!' },
    ]);
    expect(lines(userId(4))).toEqual([
      { icon: '🍬', text: 'You got a treat here today!' },
      { icon: '', text: 'Come back tomorrow for more.' },
    ]);
  });
});

describe('prizeToast (#515, until the door scene)', () => {
  it('names the treat: Heartdust, a Keeper costume, or a squishy costume', () => {
    expect(
      prizeToast({ trick: false, prize: { kind: 'heartdust', itemId: 'heartdust', count: 2 } }),
    ).toBe('💗 Treat! 2 Heartdust for you!');
    expect(
      prizeToast({
        trick: false,
        prize: { kind: 'keeper-costume', itemId: 'bat-buddy', count: 1 },
      }),
    ).toBe('🎃 Treat! A Bat Buddy costume for you!');
    expect(
      prizeToast({
        trick: false,
        prize: { kind: 'squishy-costume', itemId: 'vampire-cape', count: 1 },
      }),
    ).toBe('🎃 Treat! A Vampire Cape for your squishies!');
  });

  it('plays the silly trick first, then the treat anyway', () => {
    expect(
      prizeToast({ trick: true, prize: { kind: 'heartdust', itemId: 'heartdust', count: 1 } }),
    ).toBe('👻 Boo! Just a silly trick! 💗 Treat! 1 Heartdust for you!');
  });

  it("still says something kind for a costume this build doesn't know", () => {
    expect(
      prizeToast({
        trick: false,
        prize: { kind: 'keeper-costume', itemId: 'brand-new', count: 1 },
      }),
    ).toBe(TRICK_TEXT.someCostume);
  });

  it('uses no avoided words', () => {
    const texts = [
      TRICK_TEXT.knock,
      TRICK_TEXT.knocking,
      TRICK_TEXT.visited,
      TRICK_TEXT.open,
      TRICK_TEXT.lit,
      TRICK_TEXT.gotOne,
      TRICK_TEXT.comeBack,
      TRICK_TEXT.trick,
      TRICK_TEXT.someCostume,
      TRICK_TEXT.heartdust(2),
      TRICK_TEXT.keeperCostume('Owl Hood'),
      TRICK_TEXT.squishyCostume('Owl Hood'),
    ];
    for (const text of texts) expect(findAvoidedWords(text)).toEqual([]);
  });
});

describe('litHosts (#515)', () => {
  it('lights the porch of every lit home, and none out of season', () => {
    expect(litHosts(view())).toEqual(new Set([userId(3), userId(4)]));
    expect(litHosts(view({ open: false }))).toEqual(new Set());
    expect(litHosts(null)).toEqual(new Set());
  });
});
