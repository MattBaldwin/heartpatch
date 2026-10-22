import { HEART_COIN_RULES, type HeartCoins } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  HEART_COIN_ROWS,
  HEART_COINS_TEXT,
  heartCoinRow,
  heartCoinsPage,
} from './heart-coins-model.js';

const NOW = Date.parse('2026-10-20T18:48:00.000Z');
/** The game clock at `at`. */
const clockAt = (at: number) => ({ msUntil: (iso: string) => Math.max(0, Date.parse(iso) - at) });

const coins = (over: Partial<HeartCoins> = {}): HeartCoins => ({
  balance: 42,
  today: { battle: 4, capture: 5, care: 2, sell: 0 },
  caps: { ...HEART_COIN_RULES.dailyCaps },
  // 5 h 12 min after NOW.
  resetsAt: '2026-10-21T00:00:00.000Z',
  ...over,
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
    const page = heartCoinsPage(coins(), clockAt(NOW), null);
    expect(page.balance).toBe(42);
    expect(page.rows.map((r) => r.source)).toEqual([...HEART_COIN_ROWS]);
    // Selling is the post's Sell tab (#601 PR 4): its bar is last.
    expect(page.rows.map((r) => r.source)).toEqual(['battle', 'capture', 'care', 'sell']);
    expect(page.rows.map((r) => r.value)).toEqual(['4 / 20', '5 / 15', '2 / 10', '0 / 30']);
    expect(page.rows.at(-1)?.label).toBe('Selling extras');
    expect(page.allFull).toBe(false);
  });

  it('counts down to the patch midnight on the game clock, as other countdowns do', () => {
    const page = heartCoinsPage(coins(), clockAt(NOW), null);
    expect(page.resets).toBe('More to earn in 5h 12m');
    expect(page.ask).toBe(false);
  });

  it('asks for a fresh reply once the patch midnight passes, and only once', () => {
    const after = clockAt(Date.parse('2026-10-21T00:00:30Z'));
    const first = heartCoinsPage(coins(), after, null);
    expect(first.ask).toBe(true);
    expect(first.resets).toBe('More to earn in less than a minute');
    expect(heartCoinsPage(coins(), after, '2026-10-21T00:00:00.000Z').ask).toBe(false);
  });

  it('is all full when every bar is', () => {
    const { battle, capture, care, sell } = HEART_COIN_RULES.dailyCaps;
    const page = heartCoinsPage(
      coins({ today: { battle, capture, care, sell } }),
      clockAt(NOW),
      null,
    );
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
