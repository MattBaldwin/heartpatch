import { describe, expect, it } from 'vitest';
import { LONG_NIGHT_CONFIG } from './long-night-config.js';
import {
  longNightGates,
  renderLongNight,
  runLongNight,
  simulatePatch,
  strengthTable,
} from './long-night.js';

const casual = LONG_NIGHT_CONFIG.kids.find((k) => k.id === 'casual')!;
const small = { ...LONG_NIGHT_CONFIG, runs: 60 };

describe('the Long Night model (#727)', () => {
  it('finds four Long Nights in month one, one a week', () => {
    for (let startDay = 0; startDay < 7; startDay++) {
      expect(simulatePatch(LONG_NIGHT_CONFIG, casual, 1, 'stocked', startDay, 0)).toHaveLength(4);
    }
  });

  it('plays 3x through the stage odds, never past 100', () => {
    const table = strengthTable(100);
    expect(table.find((r) => r.from === 3)?.longNight).toEqual([75]);
    expect(table.find((r) => r.from === 7)?.longNight).toEqual([100, 45]);
    expect(table.find((r) => r.from === 14)?.longNight).toEqual([100, 100, 100]);
    expect(strengthTable(0).every((r) => r.longNight.every((c) => c === 0))).toBe(true);
  });

  it('is the same run for the same seed', () => {
    expect(runLongNight(small)).toEqual(runLongNight(small));
  });
});

describe('runLongNight: the gates', () => {
  const rows = runLongNight(LONG_NIGHT_CONFIG);

  it('passes all three of the plan’s gates', () => {
    for (const gate of longNightGates(rows, LONG_NIGHT_CONFIG))
      expect(gate.pass, gate.label).toBe(true);
    expect(renderLongNight(rows, LONG_NIGHT_CONFIG, { seconds: 0 })).not.toContain('FAIL');
  });
});
