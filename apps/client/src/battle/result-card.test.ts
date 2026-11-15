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

const names = (id: string) => (id === PEBBLE ? 'Pebblesnooze' : 'Mossmuffin');

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
