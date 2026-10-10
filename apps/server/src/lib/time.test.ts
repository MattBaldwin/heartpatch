import { describe, expect, it } from 'vitest';
import {
  canonicalTimeZone,
  createClock,
  localDate,
  localDateHour,
  mapLocalTime,
  nextLocalMidnight,
  spawnWindowId,
} from './time.js';

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

  it("keeps today's names where ICU resolves an old link (Postgres has no links)", () => {
    expect(canonicalTimeZone('Asia/Yangon')).toBe('Asia/Yangon');
    expect(canonicalTimeZone('Asia/Rangoon')).toBe('Asia/Yangon');
    expect(canonicalTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(canonicalTimeZone('Europe/Kyiv')).toBe('Europe/Kyiv');
    expect(canonicalTimeZone('US/Central')).toBe('America/Chicago');
  });

  it('keeps the wall clock of every zone Intl knows, and is idempotent', () => {
    const at = new Date('2026-07-01T12:00:00Z');
    for (const zone of Intl.supportedValuesOf('timeZone')) {
      const canonical = canonicalTimeZone(zone);
      expect(canonical, zone).not.toBeNull();
      // Same wall clock as the zone asked for.
      expect(mapLocalTime(at, canonical as string), zone).toEqual(mapLocalTime(at, zone));
      // Idempotent: a stored name canonicalizes to itself.
      expect(canonicalTimeZone(canonical as string), zone).toBe(canonical);
    }
  });
});

describe('spawnWindowId (tech spec §8)', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const zone = 'America/Denver';
  /** Every window id over a map-local day, sampled every 15 minutes from `startUtc`. */
  const windowsOver = (startUtc: string, hours = 4, span = 30) => {
    const ids: string[] = [];
    for (
      let t = Date.parse(startUtc);
      t < Date.parse(startUtc) + span * HOUR_MS;
      t += HOUR_MS / 4
    ) {
      ids.push(spawnWindowId(new Date(t), zone, hours));
    }
    return ids;
  };
  /** Real hours each window lasted, by id. */
  const lengths = (ids: string[]) => {
    const quarters = new Map<string, number>();
    for (const id of ids) quarters.set(id, (quarters.get(id) ?? 0) + 1);
    return new Map([...quarters].map(([id, q]) => [id, q / 4]));
  };
  const ordered = (ids: string[]) => {
    const key = (id: string) => {
      const [date, block] = id.split('/');
      return `${date ?? ''}/${(block ?? '').padStart(2, '0')}`;
    };
    for (let i = 1; i < ids.length; i++) expect(key(ids[i]!) >= key(ids[i - 1]!)).toBe(true);
  };

  it('is the map-local date and block', () => {
    // 2026-10-31 20:30 in Denver (MDT, UTC-6).
    expect(spawnWindowId(new Date('2026-11-01T02:30:00Z'), zone, 4)).toBe('2026-10-31/5');
    expect(spawnWindowId(new Date('2026-11-01T02:30:00Z'), 'UTC', 4)).toBe('2026-11-01/0');
    expect(localDateHour(new Date('2026-11-01T06:00:00Z'), zone)).toEqual({
      date: '2026-11-01',
      hour: 0,
    });
  });

  it('has six even 4-hour windows on a normal day', () => {
    const ids = windowsOver('2026-10-02T06:00:00Z', 4, 24);
    expect([...lengths(ids).values()]).toEqual([4, 4, 4, 4, 4, 4]);
    ordered(ids);
  });

  it('has one 3-hour window on the spring-forward day', () => {
    // 2027-03-14: 02:00 MST jumps to 03:00 MDT.
    const ids = windowsOver('2027-03-14T07:00:00Z', 4, 23);
    const day = lengths(ids);
    expect(day.get('2027-03-14/0')).toBe(3);
    expect([...day.values()].slice(1)).toEqual([4, 4, 4, 4, 4]);
    ordered(ids);
  });

  it('has one 5-hour window on the fall-back day, the repeated hour staying in it', () => {
    // 2026-11-01: 02:00 MDT falls back to 01:00 MST.
    const ids = windowsOver('2026-11-01T06:00:00Z', 4, 25);
    const day = lengths(ids);
    expect(day.get('2026-11-01/0')).toBe(5);
    expect([...day.values()].slice(1)).toEqual([4, 4, 4, 4, 4]);
    ordered(ids);
    expect(new Set(ids).size).toBe(6);
  });

  it('gives unique, ordered ids across days for any window length', () => {
    for (const hours of [1, 2, 3, 6, 8, 12, 24]) {
      const ids = windowsOver('2026-10-30T06:00:00Z', hours, 72);
      ordered(ids);
      // A window id never comes back once the next has started.
      const runs = ids.filter((id, i) => id !== ids[i - 1]);
      expect(new Set(runs).size).toBe(runs.length);
    }
  });

  it('refuses window lengths that don’t divide a day', () => {
    expect(() => spawnWindowId(new Date(), zone, 5)).toThrow(/divide a day/);
  });
});

describe('mapLocalTime (map-local wall clock)', () => {
  it('follows daylight saving in the map time zone', () => {
    // Denver falls back on Nov 1, 2026: 21:00 is 03:00Z before and 04:00Z after.
    expect(mapLocalTime(new Date('2026-10-31T03:00:00Z'), 'America/Denver')).toEqual({
      date: '2026-10-30',
      minute: 21 * 60,
    });
    expect(mapLocalTime(new Date('2026-11-02T04:00:00Z'), 'America/Denver')).toEqual({
      date: '2026-11-01',
      minute: 21 * 60,
    });
    expect(mapLocalTime(new Date('2026-11-02T03:59:00Z'), 'America/Denver').minute).toBe(
      20 * 60 + 59,
    );
    // Spring forward, Mar 8 2026: 21:00 MDT is 03:00Z.
    expect(mapLocalTime(new Date('2026-03-09T03:00:00Z'), 'America/Denver')).toEqual({
      date: '2026-03-08',
      minute: 21 * 60,
    });
    expect(mapLocalTime(new Date('2026-10-02T05:30:00Z'), 'Asia/Kolkata')).toEqual({
      date: '2026-10-02',
      minute: 11 * 60,
    });
    expect(mapLocalTime(new Date('2026-10-02T06:00:00Z'), 'UTC').minute).toBe(6 * 60);
  });
});

describe('nextLocalMidnight', () => {
  it("is the zone's next midnight, not UTC's", () => {
    const at = new Date('2026-10-31T23:30:00Z');
    expect(nextLocalMidnight(at, 'UTC').toISOString()).toBe('2026-11-01T00:00:00.000Z');
    // 6:30 PM in Chicago (CDT, UTC−5): midnight is 05:00 UTC.
    expect(nextLocalMidnight(at, 'America/Chicago').toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  it('is a whole day ahead at midnight itself', () => {
    const midnight = new Date('2026-11-01T00:00:00Z');
    expect(nextLocalMidnight(midnight, 'UTC').toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('follows daylight saving (a 25-hour day in Chicago)', () => {
    // Nov 1, 2026: clocks go back at 2 AM, so that day starts at 05:00 UTC and ends at 06:00 UTC.
    const morning = new Date('2026-11-01T06:00:00Z');
    expect(nextLocalMidnight(morning, 'America/Chicago').toISOString()).toBe(
      '2026-11-02T06:00:00.000Z',
    );
  });
});
