import { describe, expect, it } from 'vitest';
import { cleanBadgeLine, PERF_BADGE_LINE_MAX, PerfReportSchema } from './perf-report.js';

describe('cleanBadgeLine', () => {
  it('keeps a real badge line as it is', () => {
    const line =
      'page · 1 engine · 31 fr/s · 4 snap · rt 3: 1179x2556, 590x1278 ×2 · 1 canvas · 1834 dom · 3 css · nopost';
    expect(cleanBadgeLine(line)).toBe(line);
  });

  it('cuts a long line and replaces anything else, so the report still validates', () => {
    const cleaned = cleanBadgeLine(`<b>"hi"</b>\n${'x'.repeat(PERF_BADGE_LINE_MAX)}`);
    expect(cleaned).toHaveLength(PERF_BADGE_LINE_MAX);
    expect(cleaned.startsWith('_b__hi__/b__')).toBe(true);
    expect(PerfReportSchema.shape.badge.safeParse([cleaned]).success).toBe(true);
  });
});
