import { describe, expect, it } from 'vitest';
import { POTION_SIM_CONFIG, renderPotionReport, runPotionSim } from './potions.js';

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
});
