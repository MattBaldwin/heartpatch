import { describe, expect, it } from 'vitest';
import { HOLLOW_RULES } from '../data/hollow.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { LONG_NIGHT_RULES } from '../data/long-night.js';
import { LONG_NIGHT_SECRETS } from '../data/server/long-night.js';
import type { MapLocalTime } from '../home/hearthfire.js';
import { addDays } from '../home/local-date.js';
import { LongNightOutcomeSchema } from '../schemas/events.js';
import {
  gapWindow,
  isGapOpen,
  isKeeperCounted,
  isLongNight,
  keeperOfTheNight,
  longNightPercent,
  nextLongNight,
  nextLongNightAt,
  patchHeld,
  weekdayOf,
} from './index.js';

const SATURDAY = 6;
const at = (date: string, minute: number): MapLocalTime => ({ date, minute });

/**
 * The instant a map-local time names in `timeZone`, for the DST test only
 * (shared code doesn't use `Intl`; the server's `instantOfLocal` does this).
 */
function instantIn(timeZone: string) {
  return (local: MapLocalTime): Date => {
    const guess = Date.UTC(
      Number(local.date.slice(0, 4)),
      Number(local.date.slice(5, 7)) - 1,
      Number(local.date.slice(8, 10)),
      Math.floor(local.minute / 60),
      local.minute % 60,
    );
    // The zone's offset at the guess, then once more at the corrected time.
    const offsetAt = (ms: number) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      }).formatToParts(new Date(ms));
      const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - ms;
    };
    const first = guess - offsetAt(guess);
    return new Date(guess - offsetAt(first));
  };
}

describe('weekdayOf (#727)', () => {
  it("is the map-local date's own weekday, 0 Sunday to 6 Saturday", () => {
    expect(weekdayOf('2026-10-31')).toBe(6); // Halloween 2026 is a Saturday
    expect(weekdayOf('2026-11-01')).toBe(0);
    expect(weekdayOf('1970-01-01')).toBe(4);
    expect(weekdayOf('1969-12-28')).toBe(0); // before the epoch too
  });
});

describe('isLongNight (#727)', () => {
  it("falls on the patch's weekday", () => {
    expect(isLongNight(SATURDAY, '2026-10-31', null)).toBe(true);
    expect(isLongNight(SATURDAY, '2026-10-30', null)).toBe(false);
    expect(isLongNight(5, '2026-10-30', null)).toBe(true);
  });

  it('never comes while Off', () => {
    for (let d = 0; d < 7; d++)
      expect(isLongNight(null, addDays('2026-10-25', d), null)).toBe(false);
  });

  it('skips a weekday within 6 nights of the last one', () => {
    // The owner moved the day from Saturday to Wednesday mid-week.
    expect(isLongNight(3, '2026-11-04', '2026-10-31')).toBe(false);
    expect(isLongNight(3, '2026-11-11', '2026-10-31')).toBe(true);
    // A week on is fine; the same Night resolved again still counts.
    expect(isLongNight(SATURDAY, '2026-11-07', '2026-10-31')).toBe(true);
    expect(isLongNight(SATURDAY, '2026-10-31', '2026-10-31')).toBe(true);
  });
});

describe('nextLongNight (#727)', () => {
  const rules = HOME_BASE_RULES;

  it("is tonight's nightfall before it, next week's after it", () => {
    expect(nextLongNight(at('2026-10-31', 600), SATURDAY, null, rules)).toEqual(
      at('2026-10-31', rules.nightfallMinute),
    );
    expect(
      nextLongNight(at('2026-10-31', rules.nightfallMinute), SATURDAY, '2026-10-31', rules),
    ).toEqual(at('2026-11-07', rules.nightfallMinute));
    expect(nextLongNight(at('2026-10-27', 0), SATURDAY, null, rules)?.date).toBe('2026-10-31');
  });

  it('is null while Off, and waits out the 6-night guard', () => {
    expect(nextLongNight(at('2026-10-27', 0), null, null, rules)).toBeNull();
    expect(nextLongNight(at('2026-11-01', 0), 3, '2026-10-31', rules)?.date).toBe('2026-11-11');
  });

  it("keeps nightfall's map time across a daylight-saving change (America/New_York)", () => {
    const instantOf = instantIn('America/New_York');
    // US clocks go back on Sunday 1 November 2026.
    const before = nextLongNightAt(at('2026-10-30', 600), SATURDAY, null, rules, instantOf);
    const after = nextLongNightAt(at('2026-11-01', 600), SATURDAY, '2026-10-31', rules, instantOf);
    expect(before?.toISOString()).toBe('2026-10-31T23:00:00.000Z'); // 7 PM EDT
    expect(after?.toISOString()).toBe('2026-11-08T00:00:00.000Z'); // 7 PM EST
    expect(nextLongNightAt(at('2026-11-01', 600), null, null, rules, instantOf)).toBeNull();
  });
});

describe('longNightPercent (#727)', () => {
  it('multiplies the patch strength, and 0 stays 0', () => {
    expect(longNightPercent(100, LONG_NIGHT_SECRETS.strengthMultiplier)).toBe(300);
    expect(longNightPercent(0, LONG_NIGHT_SECRETS.strengthMultiplier)).toBe(0);
  });

  it('stays inside the outcome bound at the highest admin strength and multiplier', () => {
    const outcome = {
      userId: '00000000-0000-4000-8000-000000000001',
      counted: true,
      held: true,
      firesLit: 0,
      fuelNights: 0,
      gapSpeciesId: null,
    };
    expect(
      LongNightOutcomeSchema.safeParse({ ...outcome, percent: longNightPercent(300, 5) }).success,
    ).toBe(true);
    expect(LongNightOutcomeSchema.safeParse({ ...outcome, percent: 1501 }).success).toBe(false);
  });
});

describe('isKeeperCounted (#727)', () => {
  it('leaves out graced and away Keepers', () => {
    expect(isKeeperCounted(false, 0, LONG_NIGHT_RULES)).toBe(true);
    expect(isKeeperCounted(false, LONG_NIGHT_RULES.awayAfterDays - 1, LONG_NIGHT_RULES)).toBe(true);
    expect(isKeeperCounted(false, LONG_NIGHT_RULES.awayAfterDays, LONG_NIGHT_RULES)).toBe(false);
    expect(isKeeperCounted(false, null, LONG_NIGHT_RULES)).toBe(false);
    expect(isKeeperCounted(true, 0, LONG_NIGHT_RULES)).toBe(false);
  });
});

describe('patchHeld (#727)', () => {
  it('holds when every counted Keeper holds', () => {
    expect(
      patchHeld([
        { counted: true, held: true },
        { counted: true, held: true },
      ]),
    ).toBe(true);
    expect(
      patchHeld([
        { counted: true, held: true },
        { counted: true, held: false },
      ]),
    ).toBe(false);
  });

  it("lets an absent Keeper's preparation help, never break", () => {
    expect(
      patchHeld([
        { counted: true, held: true },
        { counted: false, held: false },
      ]),
    ).toBe(true);
    expect(
      patchHeld([
        { counted: false, held: true },
        { counted: false, held: false },
      ]),
    ).toBe(true);
    expect(
      patchHeld([
        { counted: false, held: false },
        { counted: false, held: false },
      ]),
    ).toBe(false);
  });

  it('holds a one-member patch whenever its Keeper does, away or not', () => {
    expect(patchHeld([{ counted: true, held: true }])).toBe(true);
    expect(patchHeld([{ counted: false, held: true }])).toBe(true);
    expect(patchHeld([{ counted: true, held: false }])).toBe(false);
    expect(patchHeld([])).toBe(false);
  });
});

describe('keeperOfTheNight (#727)', () => {
  const a = '00000000-0000-4000-8000-00000000000a';
  const b = '00000000-0000-4000-8000-00000000000b';
  const c = '00000000-0000-4000-8000-00000000000c';

  it('goes to the most fires lit, then fuel nights, then the lower user id', () => {
    expect(
      keeperOfTheNight([
        { userId: a, firesLit: 2, fuelNights: 9 },
        { userId: b, firesLit: 3, fuelNights: 1 },
      ]),
    ).toBe(b);
    expect(
      keeperOfTheNight([
        { userId: c, firesLit: 3, fuelNights: 4 },
        { userId: b, firesLit: 3, fuelNights: 5 },
      ]),
    ).toBe(b);
    expect(
      keeperOfTheNight([
        { userId: c, firesLit: 3, fuelNights: 5 },
        { userId: a, firesLit: 3, fuelNights: 5 },
        { userId: b, firesLit: 3, fuelNights: 5 },
      ]),
    ).toBe(a);
  });

  it('crowns nobody when no fire was lit', () => {
    expect(keeperOfTheNight([])).toBeNull();
    expect(keeperOfTheNight([{ userId: a, firesLit: 0, fuelNights: 3 }])).toBeNull();
  });
});

describe('gapWindow (#727)', () => {
  const nightfallAt = new Date('2026-10-31T23:00:00.000Z');
  const rules = { ...LONG_NIGHT_RULES, show: HOLLOW_RULES.show };

  it('opens at the strike and stays open gapOpenHours', () => {
    const window = gapWindow(nightfallAt, true, rules);
    expect(window?.opensAt.toISOString()).toBe('2026-10-31T23:30:00.000Z');
    expect(window?.closesAt.toISOString()).toBe('2026-11-01T23:30:00.000Z');
    expect(isGapOpen(window, new Date('2026-10-31T23:29:59.999Z'))).toBe(false);
    expect(isGapOpen(window, new Date('2026-10-31T23:30:00.000Z'))).toBe(true);
    expect(isGapOpen(window, new Date('2026-11-01T23:29:59.999Z'))).toBe(true);
    expect(isGapOpen(window, new Date('2026-11-01T23:30:00.000Z'))).toBe(false);
  });

  it("is null when the patch didn't hold", () => {
    expect(gapWindow(nightfallAt, false, rules)).toBeNull();
    expect(isGapOpen(null, nightfallAt)).toBe(false);
  });
});
