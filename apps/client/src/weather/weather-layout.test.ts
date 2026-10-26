import { hexToWorld, weatherAt, worldToHex, type WeatherFront } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HEX_SIZE } from '../map/map-config.js';
import {
  WEATHER_CAPS,
  FULL_CLOUDS,
  createWeatherLayout,
  frontPosition,
  frontScale,
  layoutWeather,
} from './weather-layout.js';

const START = Date.parse('2026-10-25T10:00:00Z');
const HOUR = 3_600_000;

function front(over: Partial<WeatherFront> = {}): WeatherFront {
  return {
    id: '2026-10-25-a',
    kind: 'storm',
    from: { q: -4, r: 0 },
    to: { q: 4, r: 0 },
    startAt: new Date(START).toISOString(),
    endAt: new Date(START + 4 * HOUR).toISOString(),
    radius: 3,
    ...over,
  };
}

describe('frontPosition', () => {
  it('is off-duty before the start and from the end', () => {
    expect(frontPosition(front(), START - 1)).toBeNull();
    expect(frontPosition(front(), START + 4 * HOUR)).toBeNull();
  });

  it('starts at from and moves toward to', () => {
    const a = frontPosition(front(), START)!;
    const b = frontPosition(front(), START + 2 * HOUR)!;
    const from = hexToWorld({ q: -4, r: 0 }, HEX_SIZE);
    expect(a.x).toBeCloseTo(from.x);
    expect(b.x).toBeGreaterThan(a.x);
  });
});

describe('frontPosition on one hex', () => {
  it('stays put for a front whose from and to are the same', () => {
    const f = front({ from: { q: 2, r: -1 }, to: { q: 2, r: -1 } });
    const home = hexToWorld({ q: 2, r: -1 }, HEX_SIZE);
    expect(frontPosition(f, START + HOUR)).toEqual(home);
  });
});

describe('frontScale', () => {
  it('ramps over the first and last tenth of the life', () => {
    expect(frontScale(front(), START + 1)).toBeLessThan(0.01);
    expect(frontScale(front(), START + 2 * HOUR)).toBe(1);
    expect(frontScale(front(), START + 4 * HOUR - 1)).toBeLessThan(0.01);
    expect(frontScale(front(), START + 4 * HOUR)).toBe(0);
  });
});

describe('layoutWeather', () => {
  it("puts a storm's rain over tiles the shared weatherAt calls stormy", () => {
    const f = front();
    const now = START + 2 * HOUR;
    const out = layoutWeather([f], now, 1, createWeatherLayout());
    expect(out.rain).toBeGreaterThan(0);
    let stormy = 0;
    for (let i = 0; i < out.rain; i++) {
      const x = out.rainMatrices[i * 16 + 12]!;
      const z = out.rainMatrices[i * 16 + 14]!;
      // Each streak sits inside the front's disc, give or take half a tile.
      if (weatherAt([f], worldToHex({ x, z }, HEX_SIZE), now) === 'storm') stormy++;
    }
    expect(stormy / out.rain).toBeGreaterThan(0.8);
  });

  it('is deterministic', () => {
    const a = layoutWeather([front()], START + HOUR, 1, createWeatherLayout());
    const b = layoutWeather([front()], START + HOUR, 1, createWeatherLayout());
    expect(Array.from(a.rainMatrices)).toEqual(Array.from(b.rainMatrices));
    expect(a.clouds).toBe(b.clouds);
  });

  it('never grows the buffers and clamps to the caps', () => {
    const out = createWeatherLayout();
    const sizes = [out.cloudMatrices.length, out.rainMatrices.length, out.fogMatrices.length];
    const many = Array.from({ length: 12 }, (_, i) => front({ id: `s${i}`, radius: 6 }));
    layoutWeather(many, START + 2 * HOUR, 1, out);
    expect(out.clouds).toBeLessThanOrEqual(WEATHER_CAPS.clouds);
    expect(out.rain).toBeLessThanOrEqual(WEATHER_CAPS.rain);
    expect([out.cloudMatrices.length, out.rainMatrices.length, out.fogMatrices.length]).toEqual(
      sizes,
    );
  });

  it('thins rain by the share and draws none at zero, but keeps the clouds', () => {
    const full = layoutWeather([front()], START + 2 * HOUR, 1, createWeatherLayout());
    const half = layoutWeather([front()], START + 2 * HOUR, 0.5, createWeatherLayout());
    const none = layoutWeather([front()], START + 2 * HOUR, 0, createWeatherLayout());
    expect(half.rain).toBeLessThan(full.rain);
    expect(half.rain).toBeGreaterThan(0);
    expect(none.rain).toBe(0);
    expect(none.clouds).toBeGreaterThan(0);
  });

  it('thins and lightens the clouds for the low tier', () => {
    const at = START + 2 * HOUR;
    const full = layoutWeather([front()], at, 0, createWeatherLayout());
    const thin = layoutWeather([front()], at, 0, createWeatherLayout(), { share: 0.5, alpha: 0.5 });
    expect(thin.clouds).toBeLessThan(full.clouds);
    expect(thin.clouds).toBeGreaterThan(0);
    expect(thin.cloudColours[3]).toBeCloseTo((full.cloudColours[3] ?? 0) * 0.5);
  });

  it('fog gives fog and no clouds or rain; drought gives nothing', () => {
    const fog = layoutWeather([front({ kind: 'fog' })], START + 2 * HOUR, 1, createWeatherLayout());
    expect([fog.clouds, fog.rain]).toEqual([0, 0]);
    expect(fog.fog).toBeGreaterThan(0);
    const dry = layoutWeather(
      [front({ kind: 'drought' })],
      START + 2 * HOUR,
      1,
      createWeatherLayout(),
    );
    expect([dry.clouds, dry.rain, dry.fog]).toEqual([0, 0, 0]);
  });

  it('draws nothing with no active front', () => {
    const out = layoutWeather([front()], START - HOUR, 1, createWeatherLayout());
    expect([out.clouds, out.rain, out.fog]).toEqual([0, 0, 0]);
  });
});

describe('a storm sky', () => {
  const at = START + 2 * HOUR;

  it('keeps a lighter rain on the low tier (a storm share with the plain share at zero)', () => {
    const none = layoutWeather([front()], at, 0, createWeatherLayout());
    const low = layoutWeather([front()], at, 0, createWeatherLayout(), FULL_CLOUDS, {
      storm: 0.45,
      still: false,
    });
    const full = layoutWeather([front()], at, 1, createWeatherLayout());
    expect(none.rain).toBe(0);
    expect(low.rain).toBeGreaterThan(0);
    expect(low.rain).toBeLessThan(full.rain);
    // Plain rain stays off on that tier.
    const plain = layoutWeather(
      [front({ kind: 'rain' })],
      at,
      0,
      createWeatherLayout(),
      FULL_CLOUDS,
      {
        storm: 0.45,
        still: false,
      },
    );
    expect(plain.rain).toBe(0);
  });

  it("slants a storm's rain and makes it heavier than plain rain; plain rain falls straight", () => {
    const storm = layoutWeather([front()], at, 1, createWeatherLayout());
    const rain = layoutWeather([front({ kind: 'rain' })], at, 1, createWeatherLayout());
    expect(storm.rainAttrs[3]).toBeGreaterThan(0);
    expect(rain.rainAttrs[3]).toBe(0);
    // Matrix x-scale (index 0) is the streak's thickness.
    expect(storm.rainMatrices[0]).toBeGreaterThan(rain.rainMatrices[0] ?? 0);
  });

  it('gives each cloud a shadow, a darker lower deck, and bolts for a storm only', () => {
    const storm = layoutWeather([front()], at, 1, createWeatherLayout());
    expect(storm.clouds).toBeGreaterThan(2);
    // Every cloud has a shadow with some alpha.
    for (let i = 0; i < storm.clouds; i++)
      expect(storm.shadowColours[i * 4 + 3]).toBeGreaterThan(0);
    // The last clouds are the lower deck: below every main cloud, darker, wider and flatter.
    const plain = layoutWeather([front({ kind: 'rain' })], at, 1, createWeatherLayout());
    expect(storm.clouds).toBeGreaterThan(plain.clouds);
    const deck = (storm.clouds - 1) * 16;
    let lowestMain = Infinity;
    for (let i = 0; i < 9; i++)
      lowestMain = Math.min(lowestMain, storm.cloudMatrices[i * 16 + 13] ?? 0);
    expect(storm.cloudMatrices[deck + 13]).toBeLessThan(lowestMain);
    expect(storm.cloudColours[(storm.clouds - 1) * 4]).toBeLessThan(storm.cloudColours[0] ?? 0);
    expect(storm.cloudMatrices[deck + 5]).toBeLessThan(storm.cloudMatrices[deck] ?? 0);
    expect(storm.bolts).toBeGreaterThan(0);
    expect(storm.boltAttrs[3]).toBe(-2);
    const rain = layoutWeather([front({ kind: 'rain' })], at, 1, createWeatherLayout());
    expect(rain.bolts).toBe(0);
  });

  it('holds a couple of bolts still when motion is off, and never passes the cap', () => {
    const still = layoutWeather([front()], at, 1, createWeatherLayout(), FULL_CLOUDS, {
      storm: 1,
      still: true,
    });
    expect(still.bolts).toBeGreaterThan(0);
    expect(still.bolts).toBeLessThanOrEqual(2);
    expect(still.boltAttrs[3]).toBe(-1);
    const many = Array.from({ length: 12 }, (_, i) => front({ id: `s${String(i)}` }));
    expect(layoutWeather(many, at, 1, createWeatherLayout()).bolts).toBeLessThanOrEqual(
      WEATHER_CAPS.bolts,
    );
  });
});
