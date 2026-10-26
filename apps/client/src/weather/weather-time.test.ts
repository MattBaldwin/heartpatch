import { describe, expect, it } from 'vitest';
import { dayStartMs, localDay } from './weather-time.js';

describe('weather time', () => {
  it('finds local midnight in a zone behind UTC', () => {
    expect(new Date(dayStartMs('2026-10-25', 'America/Chicago')).toISOString()).toBe(
      '2026-10-25T05:00:00.000Z',
    );
  });

  it('follows daylight saving', () => {
    // Clocks go back on 2026-11-01 in Chicago: that day starts at CDT, the next at CST.
    expect(new Date(dayStartMs('2026-11-01', 'America/Chicago')).toISOString()).toBe(
      '2026-11-01T05:00:00.000Z',
    );
    expect(new Date(dayStartMs('2026-11-02', 'America/Chicago')).toISOString()).toBe(
      '2026-11-02T06:00:00.000Z',
    );
  });

  it('names the local day, not the UTC one', () => {
    const lateUtc = Date.parse('2026-10-26T02:00:00Z');
    expect(localDay(lateUtc, 'America/Chicago')).toBe('2026-10-25');
    expect(localDay(lateUtc, 'UTC')).toBe('2026-10-26');
  });
});
