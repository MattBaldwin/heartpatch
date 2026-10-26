import type { WeatherFront } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { PLACE_EVERY_MS, WeatherPlacer } from './weather-placer.js';

const START = Date.parse('2026-10-25T10:00:00Z');
const storm: WeatherFront = {
  id: 'a',
  kind: 'storm',
  from: { q: -3, r: 0 },
  to: { q: 3, r: 0 },
  startAt: new Date(START).toISOString(),
  endAt: new Date(START + 4 * 3_600_000).toISOString(),
  radius: 3,
};

describe('WeatherPlacer', () => {
  it('refills at most once per 30 seconds', () => {
    const p = new WeatherPlacer();
    p.setFronts([storm]);
    const t = START + 3_600_000;
    expect(p.update(t)).toBe(true);
    expect(p.update(t + 1_000)).toBe(false);
    expect(p.update(t + PLACE_EVERY_MS - 1)).toBe(false);
    expect(p.update(t + PLACE_EVERY_MS)).toBe(true);
    expect(p.placed).toBe(2);
  });

  it('refills at once for a new plan or a new rain share', () => {
    const p = new WeatherPlacer();
    p.setFronts([storm]);
    const t = START + 3_600_000;
    p.update(t);
    p.setRainShare(0.5);
    expect(p.update(t + 1)).toBe(true);
    p.setRainShare(0.5);
    expect(p.update(t + 2)).toBe(false);
    p.setFronts([]);
    expect(p.update(t + 3)).toBe(true);
    expect(p.layout.clouds).toBe(0);
  });

  it('keeps the same buffers through every refill', () => {
    const p = new WeatherPlacer();
    const before = [p.layout.cloudMatrices, p.layout.rainMatrices, p.layout.fogMatrices];
    p.setFronts([storm]);
    p.update(START + 3_600_000);
    p.setFronts([]);
    p.update(START + 3_700_000);
    expect([p.layout.cloudMatrices, p.layout.rainMatrices, p.layout.fogMatrices]).toEqual(before);
    expect(p.layout.cloudMatrices).toBe(before[0]);
  });

  it('refills if the clock goes backwards', () => {
    const p = new WeatherPlacer();
    p.setFronts([storm]);
    p.update(START + 3_600_000);
    expect(p.update(START + 1_000)).toBe(true);
  });
});
