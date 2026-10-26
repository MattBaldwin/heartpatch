import { describe, expect, it } from 'vitest';
import { WEATHER_LOOK } from './weather-config.js';
import { boltFlash, skyFlash } from './weather-flash.js';

describe('boltFlash', () => {
  it('strikes at the start of a cycle, strikes again a little later, then goes dark', () => {
    expect(boltFlash(0)).toBe(1);
    expect(boltFlash(0.1)).toBeLessThan(0.2);
    expect(boltFlash(0.2)).toBeGreaterThan(0.5);
    expect(boltFlash(0.5)).toBe(0);
    expect(boltFlash(0.9)).toBe(0);
  });
});

describe('skyFlash', () => {
  it('is dark with no bolts', () => {
    expect(skyFlash(new Float32Array(8), 0, 3)).toBe(0);
  });

  it('follows the brightest flashing bolt', () => {
    // Bolt 0 is mid-dark, bolt 1 strikes now (time 2 * speed 0.5 + phase 0 is a whole cycle).
    const attrs = new Float32Array([0.5, 0.5, 0, -2, 0, 0.5, 0, -2]);
    expect(skyFlash(attrs, 1, 2)).toBe(0);
    expect(skyFlash(attrs, 2, 2)).toBe(1);
  });

  it('holds a steady light for a held bolt, whatever the time', () => {
    const attrs = new Float32Array([0.3, 0.2, 0, -1]);
    const still = WEATHER_LOOK.storm.flash.still;
    expect(skyFlash(attrs, 1, 0)).toBe(still);
    expect(skyFlash(attrs, 1, 17.3)).toBe(still);
  });
});
