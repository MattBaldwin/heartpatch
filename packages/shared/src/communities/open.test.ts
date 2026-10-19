import { describe, expect, it } from 'vitest';
import { HOLLOW_RULES } from '../data/hollow.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { hollowedOpenAt } from './open.js';

const RULES = { ...HOME_BASE_RULES, ...HOLLOW_RULES };
const at = (minute: number) => ({ date: '2026-10-19', minute });

describe('hollowedOpenAt (#306)', () => {
  it('is open by day, from morning until nightfall', () => {
    expect(hollowedOpenAt(at(RULES.morningMinute), RULES)).toBe(true);
    expect(hollowedOpenAt(at(12 * 60), RULES)).toBe(true);
    expect(hollowedOpenAt(at(RULES.nightfallMinute - 1), RULES)).toBe(true);
  });

  it('is shut at night', () => {
    expect(hollowedOpenAt(at(RULES.nightfallMinute), RULES)).toBe(false);
    expect(hollowedOpenAt(at(0), RULES)).toBe(false);
    expect(hollowedOpenAt(at(RULES.morningMinute - 1), RULES)).toBe(false);
  });
});
