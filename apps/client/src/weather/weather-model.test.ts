import type { WeatherDay, WeatherFront, WeatherView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { dayLines, forecastPage, nowLine, WEATHER_TEXT } from './weather-model.js';

const front: WeatherFront = {
  id: 'f',
  kind: 'storm',
  from: { q: 5, r: 0 },
  to: { q: -5, r: 0 },
  startAt: '2026-10-25T19:00:00.000Z', // 14:00 in Chicago
  endAt: '2026-10-25T23:00:00.000Z',
  radius: 3,
};
const day = (fronts: WeatherFront[]): WeatherDay => ({ day: '2026-10-25', fronts });
const TZ = 'America/Chicago';

describe('dayLines with a home', () => {
  // Crosses the island east over eight hours (14:00 to 22:00 in Chicago): the
  // middle of its trip is evening, but it only sits over x = -6 early on.
  const trip: WeatherFront = {
    ...front,
    kind: 'rain',
    from: { q: -9, r: 0 },
    to: { q: 9, r: 0 },
    startAt: '2026-10-25T19:00:00.000Z',
    endAt: '2026-10-26T03:00:00.000Z',
    radius: 2,
  };
  const today = day([trip]);
  const west = { q: -6, r: 0 };
  const at = (home: typeof west, iso: string) => ({ home, nowMs: Date.parse(iso) });

  it('names the stretch over my home, not the middle of the trip', () => {
    expect(dayLines(today, TZ)[0]).toMatch(/in the evening$/);
    expect(dayLines(today, TZ, at(west, '2026-10-25T18:00:00.000Z'))[0]).toBe(
      '🌧️ Rain from the west in the afternoon',
    );
  });

  it('says "right now" while it is over my home, so the two lines agree', () => {
    const lines = dayLines(today, TZ, at(west, '2026-10-25T20:30:00.000Z'));
    expect(lines[0]).toBe('🌧️ Rain from the west, right now');
    expect(nowLine('rain')).toMatch(/Rain is pattering/);
  });

  it('says so when a front misses my home', () => {
    const north = { q: 0, r: 6 };
    expect(dayLines(today, TZ, at(north, '2026-10-25T18:00:00.000Z'))[0]).toMatch(
      /, missing your home$/,
    );
  });
});

describe('forecastPage', () => {
  it('without a vane: tomorrow is one line and today shows no fronts', () => {
    const view: WeatherView = {
      today: day([front]),
      tomorrow: { summary: 'Rain from the east in the evening' },
      serverTime: '2026-10-25T18:00:00.000Z',
    };
    const page = forecastPage(view, 'clear', TZ);
    expect(page.hasVane).toBe(false);
    expect(page.today).toBeNull();
    expect(page.tomorrow).toEqual({ summary: 'Rain from the east in the evening', lines: [] });
  });

  it('with a vane: every front, with where from and when', () => {
    const view: WeatherView = {
      today: day([front]),
      tomorrow: day([{ ...front, kind: 'rain' }]),
      serverTime: '2026-10-25T18:00:00.000Z',
    };
    const page = forecastPage(view, 'storm', TZ);
    expect(page.hasVane).toBe(true);
    expect(page.today).toHaveLength(1);
    expect(page.today?.[0]).toMatch(/^⛈️ A storm from the .+ in the afternoon$/);
    expect(page.tomorrow.lines[0]).toMatch(/^🌧️ Rain from the/);
  });

  it('keeps the words cozy', () => {
    const all = [
      WEATHER_TEXT.stormTip,
      WEATHER_TEXT.noVane,
      ...(['clear', 'rain', 'storm', 'fog', 'drought'] as const).map(nowLine),
    ].join(' ');
    expect(all).not.toMatch(/damag|destroy|broke/i);
  });
});
