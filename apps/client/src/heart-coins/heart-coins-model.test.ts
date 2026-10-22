import { HEART_COIN_RULES, type HeartCoins } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  HEART_COIN_ROWS,
  HEART_COINS_TEXT,
  heartCoinRow,
  heartCoinsPage,
  waitText,
} from './heart-coins-model.js';

const NOW = Date.parse('2026-10-20T18:48:00.000Z');

const coins = (over: Partial<HeartCoins> = {}): HeartCoins => ({
  balance: 42,
  today: { battle: 4, capture: 5, care: 2, sell: 0 },
  caps: { ...HEART_COIN_RULES.dailyCaps },
  // 5 h 12 min after NOW.
  resetsAt: '2026-10-21T00:00:00.000Z',
  ...over,
});

describe('waitText', () => {
  it('reads hours and minutes, rounded up to the minute', () => {
    expect(waitText(5 * 3_600_000 + 12 * 60_000)).toBe('5 h 12 min');
    expect(waitText(5 * 3_600_000 + 11 * 60_000 + 1)).toBe('5 h 12 min');
    expect(waitText(2 * 3_600_000)).toBe('2 h');
    expect(waitText(12 * 60_000)).toBe('12 min');
  });

  it('never says 0 min', () => {
    expect(waitText(1)).toBe('1 min');
    expect(waitText(0)).toBe('1 min');
  });
});

describe('heartCoinRow', () => {
  const caps = { battle: 20, capture: 15, care: 10, sell: 30 };

  it('shows earned against the cap, with the bar to match', () => {
    const row = heartCoinRow('battle', { battle: 5, capture: 0, care: 0, sell: 0 }, caps);
    expect(row).toMatchObject({ earned: 5, cap: 20, percent: 25, full: false, value: '5 / 20' });
  });

  it('says all done once a source is capped', () => {
    const row = heartCoinRow('care', { battle: 0, capture: 0, care: 10, sell: 0 }, caps);
    expect(row).toMatchObject({ percent: 100, full: true, value: HEART_COINS_TEXT.allDone });
  });

  it('never draws a bar past full', () => {
    // A cap lowered mid-day (a retune) leaves more earned than the new cap.
    const row = heartCoinRow('capture', { battle: 0, capture: 18, care: 0, sell: 0 }, caps);
    expect(row).toMatchObject({ earned: 15, percent: 100, full: true });
  });

  it('counts a zero cap as full, not as a divide by zero', () => {
    const row = heartCoinRow(
      'battle',
      { battle: 0, capture: 0, care: 0, sell: 0 },
      {
        ...caps,
        battle: 0,
      },
    );
    expect(row).toMatchObject({ percent: 100, full: true });
  });
});

describe('heartCoinsPage', () => {
  it('lists the sources a kid can earn from today, in order', () => {
    const page = heartCoinsPage(coins(), NOW);
    expect(page.balance).toBe(42);
    expect(page.rows.map((r) => r.source)).toEqual([...HEART_COIN_ROWS]);
    // Selling joins with the post's Sell tab (#601 PR 4).
    expect(page.rows.map((r) => r.source)).not.toContain('sell');
    expect(page.rows.map((r) => r.value)).toEqual(['4 / 20', '5 / 15', '2 / 10']);
    expect(page.allFull).toBe(false);
  });

  it('counts down to the patch midnight on the game clock', () => {
    expect(heartCoinsPage(coins(), NOW).resets).toBe('More to earn in 5 h 12 min');
  });

  it('says any minute now once midnight has passed but the reply has not caught up', () => {
    expect(heartCoinsPage(coins(), Date.parse('2026-10-21T00:00:30Z')).resets).toBe(
      HEART_COINS_TEXT.resetsSoon,
    );
  });

  it('is all full when every bar is', () => {
    const { battle, capture, care } = HEART_COIN_RULES.dailyCaps;
    const page = heartCoinsPage(coins({ today: { battle, capture, care, sell: 0 } }), NOW);
    expect(page.allFull).toBe(true);
  });
});

describe('HEART_COINS_TEXT', () => {
  it('says one coin, not one coins', () => {
    expect(HEART_COINS_TEXT.label(1)).toBe('1 Heart Coin');
    expect(HEART_COINS_TEXT.label(0)).toBe('0 Heart Coins');
  });

  it('tells Heart Coins and Patch Coins apart in kid words', () => {
    expect(HEART_COINS_TEXT.heartLine).toMatch(/this patch/);
    expect(HEART_COINS_TEXT.patchLine).toMatch(/everywhere/);
    for (const line of Object.values(HEART_COINS_TEXT)) {
      if (typeof line !== 'string') continue;
      expect(line).not.toMatch(/village|community/i);
      // Style guide §2: short sentences, most under ~10 words.
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        expect(sentence.split(' ').length).toBeLessThanOrEqual(10);
      }
    }
  });
});
