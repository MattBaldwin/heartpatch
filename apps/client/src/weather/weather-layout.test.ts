import { hexToWorld, weatherAt, worldToHex, type WeatherFront } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HEX_SIZE } from '../map/map-config.js';
import {
  WEATHER_CAPS,
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
