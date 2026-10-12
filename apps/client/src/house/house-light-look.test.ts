import { describe, expect, it } from 'vitest';
import { SKY_LOOKS } from '../explore/explore-sky-look.js';
import { HOUSE_TIMES } from './house-config.js';
import {
  DUSK_LOOK,
  houseLookAt,
  houseLookAtMinute,
  houseLookNow,
  sameHouseLook,
} from './house-light-look.js';

const at = (h: number, m = 0) => h * 60 + m;

describe('the house light look (#381 H2)', () => {
  it('follows explore’s clock: night, dawn, day, dusk, night', () => {
    expect(houseLookAtMinute(at(2)).phase).toBe('night');
    expect(houseLookAtMinute(at(6, 10)).phase).toBe('dawn');
    expect(houseLookAtMinute(at(12)).phase).toBe('day');
    expect(houseLookAtMinute(at(17, 30)).phase).toBe('dusk');
    expect(houseLookAtMinute(at(20)).phase).toBe('night');
    // Wraps round the day.
    expect(houseLookAtMinute(at(20) + 24 * 60).phase).toBe('night');
  });

  it('lights the lamps and the fire at dusk and night, and not by day', () => {
    expect(houseLookAtMinute(at(12)).lit).toBe(false);
    expect(houseLookAtMinute(at(18)).lit).toBe(true);
    expect(houseLookAtMinute(at(23)).lit).toBe(true);
    expect(houseLookAtMinute(at(12)).lamps).toBeLessThan(houseLookAtMinute(at(23)).lamps);
  });

  it('shows dark blue windows at night and daylight ones by day', () => {
    expect(houseLookAtMinute(at(1)).pane).toBe('night');
    expect(houseLookAtMinute(at(12)).pane).toBe('day');
    expect(houseLookAtMinute(at(18)).pane).toBe('dusk');
  });

  it('uses explore’s sky colours at the top of the dome', () => {
    expect(houseLookAtMinute(at(12)).sky[5]).toBe(SKY_LOOKS.day.zenith);
    expect(houseLookAtMinute(at(2)).sky[5]).toBe(SKY_LOOKS.night.zenith);
  });

  it('keeps dusk the look B4 was judged on', () => {
    const { phase, ...look } = houseLookAtMinute(at(18));
    expect(phase).toBe('dusk');
    expect(look).toEqual(HOUSE_TIMES.dusk);
    expect(DUSK_LOOK.phase).toBe('dusk');
  });

  it('fades colours and strengths, and switches the windows and the lamps halfway', () => {
    const early = houseLookAt({ phase: 'day', next: 'dusk', blend: 0.25 });
    const late = houseLookAt({ phase: 'day', next: 'dusk', blend: 0.75 });
    expect(early.lit).toBe(false);
    expect(late.lit).toBe(true);
    expect(early.pane).toBe('day');
    expect(late.pane).toBe('dusk');
    expect(early.clear).not.toBe(HOUSE_TIMES.day.clear);
    expect(early.clear).not.toBe(HOUSE_TIMES.dusk.clear);
    expect(early.lamps).toBeCloseTo(0.35 + 0.25 * (1 - 0.35));
    expect(houseLookAt({ phase: 'day', next: 'dusk', blend: 1 }).clear).toBe(
      HOUSE_TIMES.dusk.clear,
    );
  });

  it('keeps night a friendly blue, never black (art bible §2)', () => {
    const night = houseLookAtMinute(at(2));
    for (const c of [...night.sky, night.clear, night.haze]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      expect(Math.max(r!, g!, b!)).toBeGreaterThan(70);
      expect(b!).toBeGreaterThan(r!);
    }
  });

  it('reads the patch’s own clock, and a quiet minute looks the same', () => {
    const noon = new Date('2026-10-12T17:00:00Z'); // noon in Chicago, 5 pm in UTC
    expect(houseLookNow('America/Chicago', noon).phase).toBe('day');
    expect(houseLookNow('UTC', noon).phase).toBe('dusk');
    expect(sameHouseLook(houseLookAtMinute(at(12)), houseLookAtMinute(at(12, 1)))).toBe(true);
    expect(sameHouseLook(houseLookAtMinute(at(12)), houseLookAtMinute(at(16, 50)))).toBe(false);
  });
});
