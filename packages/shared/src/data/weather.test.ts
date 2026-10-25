import { describe, expect, it } from 'vitest';
import { checkWeatherRules, WeatherKindSchema } from '../schemas/data/weather.js';
import { WeatherViewSchema } from '../schemas/weather.js';
import { SEASONS } from './seasons.js';
import { WEATHER_RULES } from './weather.js';

const seasonIds = new Set(SEASONS.map((s) => s.id));

describe('weather rules (Wild Isle, #621)', () => {
  it('pass their checks', () => {
    expect(checkWeatherRules(WEATHER_RULES, seasonIds)).toEqual([]);
  });

  it('know clear, rain, storm, fog and drought days, and every kind can come up', () => {
    expect(WeatherKindSchema.options).toEqual(['clear', 'rain', 'storm', 'fog', 'drought']);
    expect(WEATHER_RULES.days.map((d) => d.kind).sort()).toEqual(
      [...WeatherKindSchema.options].sort(),
    );
  });

  it('catch unknown seasons, repeated kinds and empty weights', () => {
    const broken = {
      ...WEATHER_RULES,
      days: [...WEATHER_RULES.days, { kind: 'rain', weight: 3 }],
      seasons: [
        { season: 'monsoon', days: [{ kind: 'rain', weight: 1 }] },
        { season: 'halloween', days: [{ kind: 'fog', weight: 1 }] },
        { season: 'halloween', days: [{ kind: 'fog', weight: 1 }] },
      ],
    };
    const problems = checkWeatherRules(broken, seasonIds).join('\n');
    expect(problems).toMatch(/days.5.kind: "rain" twice/);
    expect(problems).toMatch(/seasons.0.season: unknown season "monsoon"/);
    expect(problems).toMatch(/seasons.2.season: "halloween" twice/);
    expect(
      checkWeatherRules({ ...WEATHER_RULES, days: [{ kind: 'rain', weight: 0 }] }, seasonIds),
    ).not.toEqual([]);
    expect(
      checkWeatherRules({ ...WEATHER_RULES, days: [{ kind: 'hail', weight: 1 }] }, seasonIds),
    ).not.toEqual([]);
    const backwards = { ...WEATHER_RULES.fronts, radius: { min: 3, max: 2 } };
    expect(checkWeatherRules({ ...WEATHER_RULES, fronts: backwards }, seasonIds)).not.toEqual([]);
  });

  it('parses a weather view: tomorrow in full or as a summary, and no clear fronts', () => {
    const front = {
      id: 'f1',
      kind: 'storm',
      from: { q: -18, r: 4 },
      to: { q: 6, r: -2 },
      startAt: '2026-10-25T13:00:00.000Z',
      endAt: '2026-10-25T19:00:00.000Z',
      radius: 2,
    };
    const today = { day: '2026-10-25', kind: 'storm', fronts: [front] };
    const serverTime = '2026-10-25T12:00:00.000Z';
    expect(WeatherViewSchema.parse({ today, tomorrow: today, serverTime }).today).toEqual(today);
    const summary = { summary: 'A storm crosses the east coast tomorrow afternoon ⛈️' };
    expect(WeatherViewSchema.parse({ today, tomorrow: summary, serverTime }).tomorrow).toEqual(
      summary,
    );
    const clear = { ...today, fronts: [{ ...front, kind: 'clear' }] };
    expect(() =>
      WeatherViewSchema.parse({ today: clear, tomorrow: summary, serverTime }),
    ).toThrow();
  });
});
