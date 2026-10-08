import { describe, expect, it } from 'vitest';
import { FIXTURE_BATTLE_RULES } from '../../tests/fixtures/battle.js';
import { checkBattleRules, type BattleRules } from '../schemas/data/battle.js';
import { scanPlayerFacingText } from './avoided-words.js';
import { BATTLE_RULES } from './battle.js';

/** Applies `edit` to a copy of the shipped rules and returns the problems. */
function problemsAfter(edit: (rules: BattleRules) => void): string[] {
  const rules = structuredClone(BATTLE_RULES);
  edit(rules);
  return checkBattleRules(rules);
}

describe('battle rules', () => {
  it('accepts the shipped rules and the pinned test rules', () => {
    expect(checkBattleRules(BATTLE_RULES)).toEqual([]);
    expect(checkBattleRules(FIXTURE_BATTLE_RULES)).toEqual([]);
  });

  it('has capture odds for every rarity, Mythic shyest on the ladder (#261)', () => {
    const shy = BATTLE_RULES.capture.rarity;
    expect(shy.mythic).toBeLessThan(shy.legendary);
    expect(
      problemsAfter((r) => {
        delete (r.capture.rarity as Partial<BattleRules['capture']['rarity']>).mythic;
      }),
    ).toEqual([expect.stringContaining('capture.rarity.mythic')]);
  });

  it('uses design doc §6 defaults: teams of 3, variance 0.9–1.1', () => {
    expect(BATTLE_RULES.teamSize).toBe(3);
    expect(BATTLE_RULES.damage).toMatchObject({ varianceMin: 0.9, varianceMax: 1.1 });
  });

  it('has callouts with no avoided words (style guide §9)', () => {
    expect(scanPlayerFacingText(BATTLE_RULES, 'BATTLE_RULES')).toEqual([]);
    expect(BATTLE_RULES.effectiveness[0]?.line).toBe('Super cozy!');
  });

  it('needs effectiveness tiers from highest to lowest, ending at 0, with unique ids', () => {
    expect(
      problemsAfter((r) => {
        r.effectiveness = [
          { id: 'good', atLeast: 1.2 },
          { id: 'good', atLeast: 1.5 },
          { id: 'weak', atLeast: 0.5 },
        ];
      }),
    ).toEqual([
      'effectiveness["good"].atLeast: tiers must go from highest atLeast to lowest',
      'effectiveness["good"].id: duplicate id "good"',
      'effectiveness["weak"].atLeast: the last tier must start at 0',
    ]);
  });

  it('rejects upside-down ranges and missing AI policies', () => {
    expect(
      problemsAfter((r) => {
        r.damage.varianceMin = 1.2;
        r.status.sleepy.minTurns = 5;
        const ai: Partial<BattleRules['ai']> = r.ai;
        delete ai.guardian;
      }),
    ).toEqual([
      'damage.varianceMax: varianceMin must not be more than varianceMax',
      'status.sleepy.maxTurns: minTurns must not be more than maxTurns',
      expect.stringMatching(/^ai\.guardian: /),
    ]);
  });
});
