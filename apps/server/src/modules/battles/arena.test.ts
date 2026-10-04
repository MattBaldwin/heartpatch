import { HOLLOW_RULES, HOME_BASE_RULES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { arenaTimeOfDay } from './arena.js';
import { DUSK_MINUTES } from './limits.js';

const at = (minute: number) => ({ date: '2026-10-31', minute });

describe('arenaTimeOfDay', () => {
  const nightfall = HOME_BASE_RULES.nightfallMinute;
  const morning = HOLLOW_RULES.morningMinute;

  it('is night from nightfall until morning, as on the map', () => {
    expect(arenaTimeOfDay(at(nightfall))).toBe('night');
    expect(arenaTimeOfDay(at(1439))).toBe('night');
    expect(arenaTimeOfDay(at(0))).toBe('night');
    expect(arenaTimeOfDay(at(morning - 1))).toBe('night');
  });

  it('is dusk just before nightfall and day otherwise', () => {
    expect(arenaTimeOfDay(at(morning))).toBe('day');
    expect(arenaTimeOfDay(at(12 * 60))).toBe('day');
    expect(arenaTimeOfDay(at(nightfall - DUSK_MINUTES - 1))).toBe('day');
    expect(arenaTimeOfDay(at(nightfall - DUSK_MINUTES))).toBe('dusk');
    expect(arenaTimeOfDay(at(nightfall - 1))).toBe('dusk');
  });
});
