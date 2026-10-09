import { describe, expect, it } from 'vitest';
import { EXPLORE_RULES } from '../data/explore.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { HOLLOW_RULES } from '../data/hollow.js';
import { ExploreSkySchema, type ExploreSky } from '../schemas/data/explore.js';
import { skyAt } from './sky.js';

const at = (h: number, m = 0) => h * 60 + m;
const { sky } = EXPLORE_RULES;

describe('explore sky (#335)', () => {
  it('follows the patch clock: night, dawn, day, dusk, night', () => {
    expect(skyAt(at(2), sky).phase).toBe('night');
    expect(skyAt(at(5, 59), sky).phase).toBe('night');
    expect(skyAt(at(6), sky).phase).toBe('dawn');
    expect(skyAt(at(12), sky).phase).toBe('day');
    expect(skyAt(at(17), sky).phase).toBe('dusk');
    expect(skyAt(at(18, 59), sky).phase).toBe('dusk');
    expect(skyAt(at(19), sky).phase).toBe('night');
    expect(skyAt(at(23, 59), sky).phase).toBe('night');
  });

  it("keeps to the game's one clock: the Hollow's night, the arena's dusk", () => {
    const { nightfallMinute } = HOME_BASE_RULES;
    const { morningMinute } = HOLLOW_RULES;
    expect(skyAt(nightfallMinute - 1, sky).next).toBe('night');
    expect(skyAt(nightfallMinute, sky).phase).toBe('night');
    expect(skyAt(morningMinute - 1, sky).phase).toBe('night');
    expect(skyAt(morningMinute, sky).phase).not.toBe('night');
    // The battle arena's dusk: 2 hours before nightfall (server `DUSK_MINUTES`).
    expect(skyAt(nightfallMinute - 120, sky).phase).toBe('dusk');
    expect(skyAt(nightfallMinute - 121, sky).phase).toBe('day');
  });

  it('fades into the next sky over the blend minutes', () => {
    expect(skyAt(at(6, 30), sky)).toEqual({ phase: 'dawn', next: 'day', blend: 0 });
    expect(skyAt(at(6, 50), sky)).toEqual({ phase: 'dawn', next: 'day', blend: 0.5 });
    expect(skyAt(at(5, 50), sky)).toEqual({ phase: 'night', next: 'dawn', blend: 0.5 });
  });

  it('wraps past midnight into the first phase', () => {
    const wrap: ExploreSky = {
      phases: [
        { from: 0, phase: 'day' },
        { from: at(20), phase: 'night' },
      ],
      blendMinutes: 60,
    };
    expect(skyAt(at(23, 30), wrap)).toEqual({ phase: 'night', next: 'day', blend: 0.5 });
    expect(skyAt(at(24) + at(1), wrap).phase).toBe('day');
    expect(skyAt(-30, wrap).phase).toBe('night');
  });

  it('refuses phases out of order or not starting at midnight', () => {
    const late = { phases: [{ from: 60, phase: 'day' }], blendMinutes: 0 };
    const order = {
      phases: [
        { from: 0, phase: 'day' },
        { from: 600, phase: 'dusk' },
        { from: 300, phase: 'night' },
      ],
      blendMinutes: 0,
    };
    expect(ExploreSkySchema.safeParse(late).success).toBe(false);
    expect(ExploreSkySchema.safeParse(order).success).toBe(false);
    const short = {
      phases: [
        { from: 0, phase: 'day' },
        { from: 600, phase: 'dusk' },
        { from: 610, phase: 'night' },
      ],
      blendMinutes: 20,
    };
    expect(ExploreSkySchema.safeParse(short).success).toBe(false);
    expect(ExploreSkySchema.safeParse(sky).success).toBe(true);
  });
});
