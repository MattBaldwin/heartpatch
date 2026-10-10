import { describe, expect, it } from 'vitest';
import {
  EXPLORE_SKY,
  exploreWorld,
  isUnderwater,
  localMinuteIn,
  SKY_LOOKS,
  skyLook,
  WATER_LOOKS,
} from './explore-sky-look.js';

describe('the explore sky look (#335)', () => {
  it('is the phase itself away from a change', () => {
    expect(skyLook({ phase: 'day', next: 'dusk', blend: 0 })).toEqual(SKY_LOOKS.day);
    expect(skyLook({ phase: 'night', next: 'night', blend: 0 })).toEqual(SKY_LOOKS.night);
  });

  it('fades colours and light, and switches stars and clouds halfway', () => {
    const early = skyLook({ phase: 'dusk', next: 'night', blend: 0.25 });
    const late = skyLook({ phase: 'dusk', next: 'night', blend: 0.75 });
    expect(early.stars).toBe(false);
    expect(late.stars).toBe(true);
    expect(early.zenith).not.toBe(SKY_LOOKS.dusk.zenith);
    expect(early.zenith).not.toBe(SKY_LOOKS.night.zenith);
    expect(early.light.sun).toBeCloseTo(0.8 - 0.25 * (0.8 - 0.55));
    expect(skyLook({ phase: 'dusk', next: 'night', blend: 1 }).zenith).toBe(SKY_LOOKS.night.zenith);
  });

  it('keeps night a friendly blue, never black (art bible §2)', () => {
    const lightness = (hex: string) =>
      Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    expect(lightness(SKY_LOOKS.night.zenith)).toBeGreaterThan(0x50);
    expect(lightness(SKY_LOOKS.night.horizon)).toBeGreaterThan(0x80);
  });

  it('never shows more clouds than it has places for', () => {
    for (const look of Object.values(SKY_LOOKS)) {
      expect(look.clouds).toBeLessThanOrEqual(EXPLORE_SKY.clouds.length);
    }
  });

  it("reads the patch's local time", () => {
    const at = new Date('2026-10-10T02:30:00Z');
    expect(localMinuteIn('UTC', at)).toBe(2 * 60 + 30);
    expect(localMinuteIn('America/New_York', at)).toBe(22 * 60 + 30);
    // An unknown zone falls back to the device's, never throws.
    expect(Number.isInteger(localMinuteIn('Not/AZone', at))).toBe(true);
  });

  it('goes underwater on a lake: no sun or clouds, bubbles, a hazy seabed (#335)', () => {
    expect(isUnderwater('lake')).toBe(true);
    expect(isUnderwater('meadow')).toBe(false);
    const day = skyLook({ phase: 'day', next: 'dusk', blend: 0 }, 'underwater');
    expect(day).toEqual(WATER_LOOKS.day);
    expect(day.sunDisc).toBe(false);
    expect(day.clouds).toBe(0);
    expect(day.stars).toBe(true);
    expect(day.fog).not.toBeNull();
    expect(skyLook({ phase: 'day', next: 'dusk', blend: 0 }).fog).toBeNull();
    // Night under the water is still blue, never black (art bible §2).
    const max = (hex: string) =>
      Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    expect(max(WATER_LOOKS.night.horizon)).toBeGreaterThan(0x60);
  });

  it('puts hills in a cave and mountains on a trail, the same cave at any hour (#335)', () => {
    expect(exploreWorld('hills')).toBe('cave');
    expect(exploreWorld('mountains')).toBe('trail');
    expect(exploreWorld('forest')).toBe('ground');
    const noon = skyLook({ phase: 'day', next: 'dusk', blend: 0 }, 'cave');
    expect(skyLook({ phase: 'night', next: 'night', blend: 0 }, 'cave')).toEqual(noon);
    expect(noon.sunDisc).toBe(false);
    expect(noon.fog).not.toBeNull();
    expect(skyLook({ phase: 'day', next: 'dusk', blend: 0 }, 'trail')).toEqual(SKY_LOOKS.day);
  });
});
