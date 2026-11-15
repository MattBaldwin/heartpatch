import { findAvoidedWords, type BattleRewards } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { coinLine, coinsText, REWARD_TEXT, xpLines } from './result-card.js';

const PEBBLE = '0190a000-0000-7000-8000-000000000001';
const MOSS = '0190a000-0000-7000-8000-000000000002';

const rewards = (over: Partial<BattleRewards> = {}): BattleRewards => ({
  xp: [
    { squishyId: PEBBLE, xp: 12, evolvingBefore: 40, evolvingAfter: 52 },
    { squishyId: MOSS, xp: 0, evolvingBefore: null, evolvingAfter: null },
  ],
  percent: 100,
  fullXpResetAt: null,
  coins: { patch: 3, heart: 3 },
  unpaid: null,
  bundle: null,
  b: null,
  ...over,
});

const MOCHI = '0190a000-0000-7000-8000-000000000003';
const FERN = '0190a000-0000-7000-8000-000000000004';
const THEIRS = '0190a000-0000-7000-8000-000000000005';

const NAMES: Record<string, string> = {
  [PEBBLE]: 'Pebblesnooze',
  [MOSS]: 'Mossmuffin',
  [MOCHI]: 'Mochi',
  [FERN]: 'Fernpuff',
  [THEIRS]: 'Theirbun',
};
const names = (id: string) => NAMES[id] ?? 'Your squishy';

type Input = Parameters<typeof coinLine>[0];
const line = (over: Partial<Input>) =>
  coinLine({
    role: 'defender',
    rewards: rewards(),
    outcome: 'won',
    scooted: false,
    opponent: 'Lee',
    ...over,
  });

describe('XP lines on the result card (#728)', () => {
  it('names each squishy that earned, with its evolving meter', () => {
    const { lines, evolving } = xpLines(rewards().xp, names);
    expect(lines).toEqual(['Pebblesnooze earned 12 XP!']);
    expect(evolving).toEqual([{ before: 40, after: 52 }]);
  });

  it('has nothing for an old battle with no rewards', () => {
    expect(xpLines([], names).lines).toEqual([]);
  });
});

describe('bench XP on the result card (#732)', () => {
  type Row = BattleRewards['xp'][number];
  const row = (squishyId: string, xp: number, over: Partial<Row> = {}): Row => ({
    squishyId,
    xp,
    evolvingBefore: 10,
    evolvingAfter: 20,
    ...over,
  });

  it('cheers a benched teammate after the fighters on a wild win', () => {
    const { lines, evolving, bench } = xpLines(
      [row(PEBBLE, 12), row(MOSS, 8), row(MOCHI, 6, { bench: true })],
      names,
    );
    expect(bench).toEqual([false, false, true]);
    expect(lines).toEqual([
      'Pebblesnooze earned 12 XP!',
      'Mossmuffin earned 8 XP!',
      'Mochi cheered from the side and earned 6 XP!',
    ]);
    expect(evolving).toEqual([
      { before: 10, after: 20 },
      { before: 10, after: 20 },
      { before: 10, after: 20 },
    ]);
  });

  it('shows only my side of a friendly, benches and all', () => {
    const friendly = rewards({
      xp: [row(PEBBLE, 5), row(MOCHI, 2, { bench: true })],
      b: {
        userId: '0190a000-0000-7000-8000-0000000000ff',
        xp: [row(THEIRS, 5), row(FERN, 2, { bench: true })],
        fullXpResetAt: null,
        coins: null,
        unpaid: null,
      },
    });
    expect(xpLines(friendly.xp, names).lines).toEqual([
      'Pebblesnooze earned 5 XP!',
      'Mochi cheered from the side and earned 2 XP!',
    ]);
  });

  it('cheers benched guards on a hold', () => {
    expect(
      xpLines(
        [row(PEBBLE, 10), row(MOCHI, 5, { bench: true }), row(FERN, 5, { bench: true })],
        names,
      ).lines,
    ).toEqual([
      'Pebblesnooze earned 10 XP!',
      'Mochi cheered from the side and earned 5 XP!',
      'Fernpuff cheered from the side and earned 5 XP!',
    ]);
  });

  it('keeps fighters first, even if a bench row comes early', () => {
    expect(xpLines([row(MOCHI, 6, { bench: true }), row(PEBBLE, 12)], names).lines).toEqual([
      'Pebblesnooze earned 12 XP!',
      'Mochi cheered from the side and earned 6 XP!',
    ]);
  });

  it('says nothing for a 0-XP bench row', () => {
    const { lines, evolving, bench } = xpLines(
      [row(PEBBLE, 12), row(MOCHI, 0, { bench: true })],
      names,
    );
    expect(lines).toEqual(['Pebblesnooze earned 12 XP!']);
    expect(evolving).toHaveLength(1);
    expect(bench).toEqual([false]);
  });

  it('gives a bench squishy that evolved no meter, like a fighter that evolved', () => {
    const { lines, evolving } = xpLines(
      [row(PEBBLE, 12), row(MOCHI, 6, { bench: true, evolvingBefore: 96, evolvingAfter: null })],
      names,
    );
    expect(lines[1]).toBe('Mochi cheered from the side and earned 6 XP!');
    expect(evolving).toEqual([{ before: 10, after: 20 }, null]);
  });

  it('reads rows without `bench` (fighters, battles before #732) exactly as before', () => {
    const legacy = [row(PEBBLE, 12), row(MOSS, 4, { evolvingBefore: null, evolvingAfter: null })];
    expect(xpLines(legacy, names)).toEqual({
      lines: ['Pebblesnooze earned 12 XP!', 'Mossmuffin earned 4 XP!'],
      evolving: [{ before: 10, after: 20 }, null],
      bench: [false, false],
    });
    expect(xpLines([row(PEBBLE, 12, { bench: false })], names).lines).toEqual([
      'Pebblesnooze earned 12 XP!',
    ]);
  });
});

describe('a live defence that held (#728)', () => {
  it('pays coins', () => {
    expect(line({})).toBe('Held! You earned 3\u00a0Patch\u00a0Coins and 💛\u00a03.');
  });

  it('says a scoot pays XP, not coins', () => {
    expect(line({ rewards: rewards({ coins: null, unpaid: 'scooted' }), scooted: true })).toBe(
      "Lee scooted home. XP still counts, coins don't.",
    );
  });

  it('says the coin pouch is full when the daily cap credited 0, never "You earned 💛\u00a00"', () => {
    expect(line({ rewards: rewards({ coins: { patch: 0, heart: 0 } }) })).toBe(
      REWARD_TEXT.pouchFull,
    );
  });

  it('says only what the cap let through', () => {
    expect(line({ rewards: rewards({ coins: { patch: 1, heart: 0 } }) })).toBe(
      'Held! You earned 1\u00a0Patch\u00a0Coin.',
    );
  });

  it('says nothing about coins for a loss, a tie, or an old battle', () => {
    expect(line({ outcome: 'lost', rewards: rewards({ coins: { patch: 0, heart: 0 } }) })).toBe(
      null,
    );
    expect(line({ outcome: 'draw' })).toBeNull();
    expect(line({ rewards: null })).toBeNull();
    expect(line({ rewards: rewards({ coins: null }) })).toBeNull();
  });
});

describe('a friendly battle (#728)', () => {
  const friendly = (over: Partial<Input>) =>
    line({ role: 'friendly', rewards: rewards({ coins: { patch: 2, heart: 2 } }), ...over });

  it('cheers the winner with their coins', () => {
    expect(friendly({})).toBe('+2\u00a0Patch\u00a0Coins and 💛\u00a02 for the\u00a0win!');
  });

  it('is kind to the loser', () => {
    expect(friendly({ outcome: 'lost', rewards: rewards({ coins: { patch: 0, heart: 0 } }) })).toBe(
      'Good game! Everyone learned something.',
    );
    // My own give-up: the title already says it.
    expect(friendly({ outcome: 'lost', scooted: true })).toBeNull();
  });

  it('says the pair cap kindly', () => {
    expect(friendly({ rewards: rewards({ coins: null, unpaid: 'pair-cap' }) })).toBe(
      "You've won your coins from Lee today. XP still counts!",
    );
  });

  it('says the computer-friend cap in its own words (#386f)', () => {
    expect(friendly({ rewards: rewards({ coins: null, unpaid: 'computer-cap' }) })).toBe(
      'Lee has played a lot today! No more coins from Computer friends until tomorrow. XP still counts!',
    );
  });

  it('pays no coins when the friend gave up', () => {
    expect(friendly({ rewards: rewards({ coins: null, unpaid: 'scooted' }), scooted: true })).toBe(
      'No coins for a give-up. XP still counts!',
    );
  });
});

describe("the challenger's coin line (#728)", () => {
  const mine = (over: Partial<Input>) => line({ role: 'challenger', ...over });

  it('says the coins a win paid', () => {
    expect(mine({})).toBe('You earned 3\u00a0Patch\u00a0Coins and 💛\u00a03.');
  });

  it('says nothing when it paid nothing or is from before #728', () => {
    expect(mine({ rewards: rewards({ coins: { patch: 0, heart: 0 } }) })).toBeNull();
    expect(mine({ rewards: rewards({ coins: null }) })).toBeNull();
    expect(mine({ rewards: null })).toBeNull();
    expect(mine({ outcome: 'lost' })).toBeNull();
  });
});

describe('reward words', () => {
  it('writes coins the way the rest of the app does', () => {
    expect(coinsText({ patch: 3, heart: 3 })).toBe('3\u00a0Patch\u00a0Coins and 💛\u00a03');
    expect(coinsText({ patch: 0, heart: 2 })).toBe('💛\u00a02');
  });

  it('never uses an avoided word', () => {
    const all = Object.values(REWARD_TEXT).map((t) => (typeof t === 'string' ? t : t('Lee', 3)));
    for (const text of all) expect(findAvoidedWords(text), text).toEqual([]);
  });
});
