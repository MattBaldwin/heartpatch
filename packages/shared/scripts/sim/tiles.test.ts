import { describe, expect, it } from 'vitest';
import { renderTileReport, runTileSim, stanceShifts } from './tiles.js';
import { TILE_SIM_CONFIG } from './tiles-config.js';

describe('tiles sim (#529)', () => {
  const tiny = { ...TILE_SIM_CONFIG, stances: ['balanced' as const], games: 1 };

  it('plays every prep × defense × Partner level once with a tiny config, and the same seed gives the same table', () => {
    const first = runTileSim(tiny);
    expect(renderTileReport(runTileSim(tiny), tiny)).toBe(renderTileReport(first, tiny));
    const perLevel = first.rows.filter((r) => r.partnerLevel !== 'all');
    expect(perLevel).toHaveLength(
      TILE_SIM_CONFIG.preps.length *
        TILE_SIM_CONFIG.defenses.length *
        TILE_SIM_CONFIG.partnerLevels.length,
    );
    expect(perLevel.every((r) => r.battles === 1)).toBe(true);
    const overall = first.rows.filter((r) => r.partnerLevel === 'all');
    expect(overall.every((r) => r.battles === TILE_SIM_CONFIG.partnerLevels.length)).toBe(true);
  });

  it('a big floor makes tiles harder, and no floor says so in the report', () => {
    const config = {
      ...tiny,
      partnerLevels: [10],
      preps: TILE_SIM_CONFIG.preps.filter((p) => p.key === 'prepared'),
      games: 4,
    };
    const wins = (partnerBonus: number | null) =>
      runTileSim({ ...config, partnerBonus }).rows.reduce((sum, r) => sum + r.wins, 0);
    expect(wins(10)).toBeLessThan(wins(null));
    const before = { ...config, partnerBonus: null };
    expect(renderTileReport(runTileSim(before), before)).toContain('No guard level floor');
  });

  it('flags a cell that moves more than the threshold under another stance', () => {
    const config = { ...tiny, stances: ['balanced' as const, 'aggressive' as const] };
    const row = (stance: 'balanced' | 'aggressive', wins: number) => ({
      stance,
      prep: 'prepared',
      defense: '2 posted, open',
      partnerLevel: 'all' as const,
      wins,
      battles: 100,
    });
    const result = { rows: [row('balanced', 60), row('aggressive', 45)], contentHash: 'x' };
    expect(stanceShifts(result, config, 10)).toEqual([
      { stance: 'aggressive', defense: '2 posted, open', prep: 'prepared', from: 60, to: 45 },
    ]);
    expect(stanceShifts(result, config, 15)).toEqual([]);
  });
});
