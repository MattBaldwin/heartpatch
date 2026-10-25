import { describe, expect, it } from 'vitest';
import { WEATHER_RULES } from '../data/weather.js';
import { hex, hexDistance, hexSpiral, type Hex } from '../hex/index.js';
import { deriveSeed } from '../rng/index.js';
import { WeatherDaySchema, type WeatherFront } from '../schemas/weather.js';
import {
  compassOf,
  coveredMinutes,
  coverWindows,
  forecastLine,
  frontCentreAt,
  frontCover,
  frontSummary,
  planWeatherDay,
  weatherAt,
  type DayWindow,
} from './plan.js';

const HOUR_MS = 60 * 60 * 1000;
const ISLAND = { radius: 18, oceanRings: 2 };
const LAND = ISLAND.radius - ISLAND.oceanRings;
/** 2026-10-25 in America/Denver (MDT, UTC−6): a plain 24-hour day. */
const DAY: DayWindow = {
  day: '2026-10-25',
  startMs: Date.parse('2026-10-25T06:00:00Z'),
  endMs: Date.parse('2026-10-26T06:00:00Z'),
};

/** A day that always sends fronts (two storms), whatever the seed rolls. */
const STORMY = {
  ...WEATHER_RULES,
  days: [{ kind: 'storm' as const, weight: 1 }],
  seasons: [],
  fronts: { ...WEATHER_RULES.fronts, perDay: { min: 2, max: 2 } },
};

const plan = (seed: string, window = DAY, rules = STORMY) =>
  planWeatherDay(seed, rules, [], window, ISLAND);

const front = (over: Partial<WeatherFront>): WeatherFront => ({
  id: 'test-0',
  kind: 'rain',
  from: hex(-5, 0),
  to: hex(5, 0),
  // 11 hexes over 11 hours: one hour on each.
  startAt: '2026-10-25T08:00:00.000Z',
  endAt: '2026-10-25T19:00:00.000Z',
  radius: 1,
  ...over,
});

describe('planWeatherDay', () => {
  it('is deterministic: the same seed gives the same day, a new seed a new one', () => {
    const a = plan(deriveSeed('map-seed', 'weather', DAY.day));
    expect(plan(deriveSeed('map-seed', 'weather', DAY.day))).toEqual(a);
    expect(WeatherDaySchema.parse(a)).toEqual(a);
    expect(plan(deriveSeed('map-seed', 'weather', '2026-10-26'))).not.toEqual(a);
    expect(a.fronts.map((f) => f.id)).toEqual(['2026-10-25-0', '2026-10-25-1']);
  });

  it('keeps every front inside its day, so nothing runs past midnight', () => {
    for (let n = 0; n < 200; n++) {
      for (const f of plan(`clip-${String(n)}`).fronts) {
        expect(Date.parse(f.startAt)).toBeGreaterThanOrEqual(DAY.startMs);
        expect(Date.parse(f.endAt)).toBeLessThanOrEqual(DAY.endMs);
        expect(Date.parse(f.endAt)).toBeGreaterThan(Date.parse(f.startAt));
      }
    }
  });

  it('fits a 23-hour and a 25-hour daylight-saving day', () => {
    // Denver: spring forward on 2026-03-08 (MST → MDT), fall back on 2026-11-01.
    const short: DayWindow = {
      day: '2026-03-08',
      startMs: Date.parse('2026-03-08T07:00:00Z'),
      endMs: Date.parse('2026-03-09T06:00:00Z'),
    };
    const long: DayWindow = {
      day: '2026-11-01',
      startMs: Date.parse('2026-11-01T06:00:00Z'),
      endMs: Date.parse('2026-11-02T07:00:00Z'),
    };
    expect(short.endMs - short.startMs).toBe(23 * HOUR_MS);
    expect(long.endMs - long.startMs).toBe(25 * HOUR_MS);
    // The slowest pace on a long path would need more than 23 hours: it speeds up.
    const slow = { ...STORMY, fronts: { ...STORMY.fronts, tilesPerHour: { min: 1, max: 1 } } };
    for (const window of [short, long]) {
      for (let n = 0; n < 50; n++) {
        for (const f of plan(`dst-${String(n)}`, window, slow).fronts) {
          expect(Date.parse(f.startAt)).toBeGreaterThanOrEqual(window.startMs);
          expect(Date.parse(f.endAt)).toBeLessThanOrEqual(window.endMs);
          expect(f.id.startsWith(window.day)).toBe(true);
        }
      }
    }
  });

  it('starts and ends every front out at sea, crossing the island between', () => {
    for (let n = 0; n < 100; n++) {
      for (const f of plan(`sea-${String(n)}`).fronts) {
        const first = frontCentreAt(f, Date.parse(f.startAt))!;
        const last = frontCentreAt(f, Date.parse(f.endAt) - 1)!;
        // Nothing it covers at either end is land.
        expect(hexDistance(first, hex(0, 0)) - f.radius).toBeGreaterThan(LAND);
        expect(hexDistance(last, hex(0, 0)) - f.radius).toBeGreaterThan(LAND);
        // It goes over the island: the middle of its path is near the centre.
        const mid = frontCentreAt(f, (Date.parse(f.startAt) + Date.parse(f.endAt)) / 2)!;
        expect(hexDistance(mid, hex(0, 0))).toBeLessThanOrEqual(LAND);
      }
    }
  });

  it('rolls the kind of day from the season running, and a clear day sends nothing', () => {
    const foggy = {
      ...WEATHER_RULES,
      days: [{ kind: 'clear' as const, weight: 1 }],
      seasons: [{ season: 'halloween', days: [{ kind: 'fog' as const, weight: 1 }] }],
    };
    expect(planWeatherDay('s', foggy, [], DAY, ISLAND)).toEqual({
      day: DAY.day,
      kind: 'clear',
      fronts: [],
    });
    const spooky = planWeatherDay('s', foggy, ['halloween'], DAY, ISLAND);
    expect(spooky.kind).toBe('fog');
    expect(spooky.fronts.every((f) => f.kind === 'fog')).toBe(true);
  });
});

describe('weatherAt', () => {
  /**
   * The client/server agreement vector: both draw and decide from shared
   * `weatherAt`, and these pinned answers keep its maths from drifting.
   * Each row is a tile, an instant and the weather there.
   */
  const AGREEMENT: { fronts: WeatherFront[]; rows: [Hex, string, string][] } = {
    fronts: [
      front({ id: 'a', kind: 'rain' }),
      front({
        id: 'b',
        kind: 'storm',
        from: hex(3, -6),
        to: hex(3, 4),
        startAt: '2026-10-25T10:30:00.000Z',
        endAt: '2026-10-25T13:47:13.000Z',
        radius: 3,
      }),
    ],
    rows: [
      [hex(0, 0), '2026-10-25T07:59:59.999Z', 'clear'],
      [hex(-5, 0), '2026-10-25T08:00:00.000Z', 'rain'],
      [hex(-4, 0), '2026-10-25T08:59:59.999Z', 'rain'],
      [hex(-4, 1), '2026-10-25T08:59:59.999Z', 'clear'],
      [hex(0, 0), '2026-10-25T12:00:00.000Z', 'storm'],
      [hex(0, 0), '2026-10-25T12:59:59.999Z', 'rain'],
      [hex(0, 0), '2026-10-25T14:00:00.000Z', 'rain'],
      [hex(0, 0), '2026-10-25T15:00:00.000Z', 'clear'],
      [hex(5, 0), '2026-10-25T18:59:59.999Z', 'rain'],
      [hex(5, 0), '2026-10-25T19:00:00.000Z', 'clear'],
      // The storm wins where both cover a tile.
      [hex(0, 0), '2026-10-25T11:59:59.999Z', 'storm'],
      [hex(2, 0), '2026-10-25T13:00:00.000Z', 'storm'],
      [hex(2, 0), '2026-10-25T13:20:00.000Z', 'clear'],
      [hex(3, -6), '2026-10-25T10:30:00.000Z', 'storm'],
      [hex(3, -6), '2026-10-25T10:47:55.000Z', 'storm'],
      [hex(3, -6), '2026-10-25T11:41:42.000Z', 'storm'],
      [hex(3, -6), '2026-10-25T11:41:43.000Z', 'clear'],
      [hex(3, 4), '2026-10-25T13:47:12.999Z', 'storm'],
      [hex(3, 4), '2026-10-25T13:47:13.000Z', 'clear'],
      [hex(8, 0), '2026-10-25T12:00:00.000Z', 'clear'],
    ],
  };

  it.each(AGREEMENT.rows)('agrees at %o, %s: %s', (tile, at, kind) => {
    expect(weatherAt(AGREEMENT.fronts, tile, Date.parse(at))).toBe(kind);
  });

  it('matches each front’s cover, tile by tile, at every step edge', () => {
    for (const f of AGREEMENT.fronts) {
      for (const tile of hexSpiral(hex(0, 0), 8)) {
        const cover = frontCover(f, tile);
        const covered = (t: number) => cover.some(([a, b]) => a <= t && t < b);
        for (const [a, b] of cover) {
          for (const t of [a - 1, a, b - 1, b]) {
            const centre = frontCentreAt(f, t);
            const inside = centre !== null && hexDistance(centre, tile) <= f.radius;
            expect(inside).toBe(covered(t));
          }
        }
      }
    }
  });
});

describe('coveredMinutes', () => {
  it('counts the minutes a front sits within its radius', () => {
    // (0, 0) is within 1 of the centre at q = −1, 0, 1: three hours.
    expect(coveredMinutes([front({})], hex(0, 0), DAY.startMs, DAY.endMs)).toEqual({ rain: 180 });
    expect(coveredMinutes([front({})], hex(0, 3), DAY.startMs, DAY.endMs)).toEqual({});
  });

  it('clips to the window and counts overlapping fronts of a kind once', () => {
    const twice = [front({}), front({ id: 'test-1' })];
    const from = Date.parse('2026-10-25T12:30:00Z');
    expect(coveredMinutes(twice, hex(0, 0), from, DAY.endMs)).toEqual({ rain: 150 });
    expect(coverWindows(twice, hex(0, 0), from, DAY.endMs)).toEqual([
      { frontId: 'test-0', kind: 'rain', fromMs: from, toMs: Date.parse('2026-10-25T15:00:00Z') },
      { frontId: 'test-1', kind: 'rain', fromMs: from, toMs: Date.parse('2026-10-25T15:00:00Z') },
    ]);
    const mixed = [front({}), front({ id: 'test-1', kind: 'storm', radius: 2 })];
    expect(coveredMinutes(mixed, hex(0, 0), DAY.startMs, DAY.endMs)).toEqual({
      rain: 180,
      storm: 300,
    });
  });
});

describe('the forecast line', () => {
  it('names the side of the island a hex lies on', () => {
    expect(compassOf(hex(18, 0))).toBe('east');
    expect(compassOf(hex(18, -18))).toBe('north-east');
    expect(compassOf(hex(0, -18))).toBe('north-west');
    expect(compassOf(hex(-18, 0))).toBe('west');
    expect(compassOf(hex(-18, 18))).toBe('south-west');
    expect(compassOf(hex(0, 18))).toBe('south-east');
    // Due north sits between two ways: the first in `HEX_DIRECTIONS` order.
    expect(compassOf(hex(9, -18))).toBe('north-east');
  });

  it('says where a front comes in from and when', () => {
    // Comes in from the west, over the island 08:00–19:00 UTC: 02:00–13:00 local, middle 07:30.
    expect(frontSummary(front({}), DAY.startMs)).toEqual({
      kind: 'rain',
      from: 'west',
      when: 'morning',
    });
    const storm = front({ kind: 'storm', from: hex(0, 6), to: hex(0, -6) });
    expect(forecastLine({ day: DAY.day, kind: 'storm', fronts: [storm] }, DAY.startMs)).toBe(
      'A storm rolls in from the south-east tomorrow morning ⛈️ Tuck your buildings in!',
    );
    expect(forecastLine({ day: DAY.day, kind: 'clear', fronts: [] }, DAY.startMs)).toBe(
      'Sunny tomorrow ☀️',
    );
    expect(forecastLine({ day: DAY.day, kind: 'drought', fronts: [] }, DAY.startMs)).toBe(
      'Dry spell tomorrow: fields are thirsty 🌵',
    );
  });
});
