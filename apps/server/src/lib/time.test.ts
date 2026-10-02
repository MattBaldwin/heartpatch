import { describe, expect, it } from 'vitest';
import { canonicalTimeZone, createClock, localDate } from './time.js';

describe('createClock', () => {
  it('is the real time without HP_DEV_NOW', () => {
    const before = Date.now();
    const now = createClock({ NODE_ENV: 'test', HP_DEV_NOW: undefined })().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('starts at HP_DEV_NOW and keeps ticking', async () => {
    const clock = createClock({ NODE_ENV: 'development', HP_DEV_NOW: '2026-12-20T20:59:00-05:00' });
    const first = clock().getTime();
    expect(first - Date.parse('2026-12-21T01:59:00Z')).toBeLessThan(1000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(clock().getTime()).toBeGreaterThan(first);
  });

  it('refuses HP_DEV_NOW in production', () => {
    expect(() =>
      createClock({ NODE_ENV: 'production', HP_DEV_NOW: '2026-12-20T20:59:00-05:00' }),
    ).toThrow(/HP_DEV_NOW/);
  });
});

describe('localDate', () => {
  it('uses the zone, not UTC', () => {
    const at = new Date('2026-11-01T03:30:00Z');
    expect(localDate(at, 'UTC')).toBe('2026-11-01');
    expect(localDate(at, 'America/Chicago')).toBe('2026-10-31');
    expect(localDate(at, 'Asia/Tokyo')).toBe('2026-11-01');
  });
});

describe('canonicalTimeZone', () => {
  it('canonicalizes known zones and rejects unknown ones', () => {
    expect(canonicalTimeZone('UTC')).toBe('UTC');
    expect(canonicalTimeZone('America/Chicago')).toBe('America/Chicago');
    expect(canonicalTimeZone('Not/AZone')).toBeNull();
  });
});
