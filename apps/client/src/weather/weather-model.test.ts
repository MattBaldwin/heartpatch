import type { WeatherDay, WeatherFront, WeatherView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { forecastPage, nowLine, WEATHER_TEXT } from './weather-model.js';

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
