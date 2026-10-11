import { describe, expect, it } from 'vitest';
import {
  POTION_SIM_CONFIG,
  renderPotionReport,
  runPotionSim,
  withWholeTurnPlans,
} from './potions.js';

describe('potion sim (#214)', () => {
  const small = {
    ...POTION_SIM_CONFIG,
    partnerLevels: [10],
    rarities: ['rare' as const],
    games: 2,
  };

  it('plays every plan against the same seeds, and the same config gives the same report', () => {
    const first = runPotionSim(small);
    expect(renderPotionReport(runPotionSim(small), small)).toBe(renderPotionReport(first, small));
    const overall = first.rows.filter((r) => r.partnerLevel === 'all');
    expect(overall.map((r) => r.plan)).toEqual(POTION_SIM_CONFIG.plans.map((p) => p.key));
    // Same number of battles for every plan.
    expect(new Set(overall.map((r) => r.battles)).size).toBe(1);
    expect(overall[0]!.battles).toBeGreaterThan(0);
  });

  it('a free sip never lowers the win rate, against faster foes too (#403)', () => {
    const config = {
      ...POTION_SIM_CONFIG,
      partnerLevels: [5, 20],
      rarities: ['common' as const, 'legendary' as const],
      games: 3,
    };
    const { rows } = runPotionSim(config);
    const none = (rarity: string, level: number | 'all') =>
      rows.find((r) => r.plan === 'none' && r.rarity === rarity && r.partnerLevel === level)!;
    const potions = rows.filter((r) => r.plan !== 'none');
    expect(potions.length).toBeGreaterThan(0);
    for (const row of potions) {
      const base = none(row.rarity, row.partnerLevel);
      expect(row.wins / row.battles).toBeGreaterThanOrEqual(base.wins / base.battles);
      expect(base.fasterBattles).toBe(row.fasterBattles);
      if (row.fasterBattles === 0) continue;
      expect(row.fasterWins / row.fasterBattles).toBeGreaterThanOrEqual(
        base.fasterWins / base.fasterBattles,
      );
    }
    expect(rows.some((r) => r.fasterBattles > 0)).toBe(true);
  });

  it('--compare adds each potion under the pre-#403 whole-turn rule', () => {
    const plans = withWholeTurnPlans(POTION_SIM_CONFIG.plans);
    expect(plans.map((p) => p.key)).toEqual([
      'none',
      'brave-brew',
      'brave-brew-whole-turn',
      'cozy-cocoa',
      'cozy-cocoa-whole-turn',
      'hearty-soup',
      'hearty-soup-whole-turn',
    ]);
    const report = renderPotionReport(
      runPotionSim({
        ...POTION_SIM_CONFIG,
        plans,
        partnerLevels: [10],
        rarities: ['rare'],
        games: 1,
      }),
      { ...POTION_SIM_CONFIG, plans, partnerLevels: [10], rarities: ['rare'] },
    );
    expect(report).toContain('## Faster foes, all Partner levels');
    expect(report).toContain('pre-#403 rule');
  });
});
