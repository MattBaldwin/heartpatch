import { describe, expect, it } from 'vitest';
import { careHeartCoins, checkHeartCoinRules } from '../schemas/data/heart-coins.js';
import { COIN_RULES } from './coins.js';
import { HEART_COIN_RULES } from './heart-coins.js';

describe('Heart Coin rules', () => {
  it('pass their checks, and a broken one is caught', () => {
    expect(checkHeartCoinRules(HEART_COIN_RULES)).toEqual([]);
    expect(
      checkHeartCoinRules({ ...HEART_COIN_RULES, battleWin: { wild: -1 } }).join('\n'),
    ).toMatch(/battleWin/);
    expect(
      checkHeartCoinRules({
        ...HEART_COIN_RULES,
        dailyCaps: { ...HEART_COIN_RULES.dailyCaps, sell: 0 },
      }),
    ).not.toEqual([]);
    expect(checkHeartCoinRules({ ...HEART_COIN_RULES, extra: 1 })).not.toEqual([]);
  });

  it('pays a battle kind exactly when Patch Coins do', () => {
    // A journey or rescue is a gate, not a farm, for either currency.
    for (const [kind, coins] of Object.entries(COIN_RULES.battleWin)) {
      const heart = HEART_COIN_RULES.battleWin[kind as keyof typeof COIN_RULES.battleWin];
      expect(heart > 0, kind).toBe(coins > 0);
    }
  });

  it('pays care only for an action that counts in full', () => {
    const per = HEART_COIN_RULES.care.perFullAction;
    expect(careHeartCoins({ full: true, counts: true }, HEART_COIN_RULES)).toBe(per);
    expect(careHeartCoins({ full: false, counts: true }, HEART_COIN_RULES)).toBe(0);
    // A Heart Snack counts in full but outside the day's care: no coins.
    expect(careHeartCoins({ full: true, counts: false }, HEART_COIN_RULES)).toBe(0);
  });
});
