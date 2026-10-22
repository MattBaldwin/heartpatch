import { describe, expect, it } from 'vitest';
import { REKINDLED } from '../../src/data/found-sets.js';
import { HOLLOWED_CONFIG } from './hollowed-config.js';
import { renderHollowed, runHollowed } from './hollowed.js';
import { PROGRESSION_CONFIG } from './progression-config.js';
import { fullSetDays, percentile, renderRekindled, runRekindled } from './rekindled.js';

// Fewer runs than the report, so the suite stays quick; the seed keeps it steady.
const CONFIG = { ...HOLLOWED_CONFIG, rekindled: { ...HOLLOWED_CONFIG.rekindled, runs: 400 } };

describe('the Rekindled set model (#306 PR 5)', () => {
  const rows = runRekindled(CONFIG);

  it('lets a casual kid find the whole set within the gate (median days of village searching)', () => {
    expect(fullSetDays(rows, 'casual')).toBeLessThanOrEqual(CONFIG.rekindled.gateDays);
  });

  it('keeps it a collection: not done in a day, quicker for an engaged kid', () => {
    expect(fullSetDays(rows, 'casual')).toBeGreaterThan(7);
    expect(fullSetDays(rows, 'engaged')).toBeLessThan(fullSetDays(rows, 'casual'));
  });

  it('finds a first piece and each recipe’s find well before the whole set', () => {
    const casual = rows.find((r) => r.kid === 'casual')!;
    const [firstPiece] = casual.days.get('first piece')!;
    expect(firstPiece).toBeLessThan(fullSetDays(rows, 'casual'));
    for (const find of REKINDLED.finds) {
      expect(casual.days.get(`first ${find}`)![0]).toBeLessThan(fullSetDays(rows, 'casual'));
    }
  });

  it('is the same every run (seeded)', () => {
    expect(runRekindled(CONFIG)).toEqual(rows);
  });

  it('takes a nearest-rank percentile', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(percentile([], 50)).toBe(Infinity);
  });

  it('renders into the Hollowed report', () => {
    expect(renderRekindled(rows, CONFIG).join('\n')).toContain('| casual |');
    const report = renderHollowed(
      runHollowed(CONFIG, PROGRESSION_CONFIG),
      CONFIG,
      { seconds: 0 },
      rows,
    );
    expect(report).toContain('## The Rekindled set (#306 PR 5)');
  });
});
