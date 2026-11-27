import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../data/resources.js';
import { ADVENT_PRESENTS } from '../data/server/advent.js';
import { AdventResultSchema } from '../schemas/christmas.js';
import { checkAdventPresents, PRESENT_ITEM } from '../schemas/data/advent.js';
import { adventClaimProblem, adventDaysOf, adventNumber, isCatchUp } from './calendar.js';
import {
  adventContents,
  adventSeed,
  presentContents,
  rollAdventPresent,
  rollPresentOpening,
} from './roll.js';

const RESOURCE_IDS = new Set(RESOURCES.map((r) => r.id));
const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';

describe('the advent calendar (#37 1c, owner answer 3)', () => {
  it('runs December 1 to 25', () => {
    expect(adventDaysOf(2026)).toHaveLength(25);
    expect(adventDaysOf(2026)[0]).toBe('2026-12-01');
    expect(adventDaysOf(2026)[24]).toBe('2026-12-25');
    expect(adventNumber('2026-12-24')).toBe(24);
    expect(adventNumber('2026-12-26')).toBeNull();
    expect(adventNumber('2026-11-30')).toBeNull();
  });

  const claim = (today: string, day: string, claimed = false, catchUpTakenToday = false) =>
    adventClaimProblem({ today, day, claimed, catchUpTakenToday });

  it("opens today's present, once", () => {
    expect(claim('2026-12-03', '2026-12-03')).toBeNull();
    expect(claim('2026-12-03', '2026-12-03', true)).toBe('claimed');
    // Today's own is never a catch-up, so a used catch-up doesn't block it.
    expect(claim('2026-12-03', '2026-12-03', false, true)).toBeNull();
    expect(isCatchUp('2026-12-03', '2026-12-03')).toBe(false);
  });

  it('opens one missed day a day, only past days', () => {
    expect(claim('2026-12-10', '2026-12-01')).toBeNull();
    expect(isCatchUp('2026-12-10', '2026-12-01')).toBe(true);
    expect(claim('2026-12-10', '2026-12-01', false, true)).toBe('catch-up-used');
    expect(claim('2026-12-10', '2026-12-11')).toBe('not-yet');
  });

  it('only December 1–25 of this year, and closes after the 25th', () => {
    expect(claim('2026-12-10', '2026-12-26')).toBe('not-advent');
    expect(claim('2026-12-10', '2026-11-30')).toBe('not-advent');
    expect(claim('2026-11-30', '2026-12-01')).toBe('not-yet');
    expect(claim('2026-12-26', '2026-12-25')).toBe('over');
    expect(claim('2027-12-02', '2026-12-01')).toBe('over');
  });
});

describe('advent presents roll (#37 1c)', () => {
  it('the shipped table passes its check', () => {
    expect(checkAdventPresents(ADVENT_PRESENTS, RESOURCE_IDS)).toEqual([]);
  });

  it('refuses a present inside an opened present, unknown items and short pools', () => {
    const bad = {
      ...ADVENT_PRESENTS,
      opening: { picks: 3, pool: [{ itemId: PRESENT_ITEM, min: 1, max: 1, weight: 1 }] },
      fixed: { '24': { 'not-a-thing': 1 } },
    };
    const problems = checkAdventPresents(bad, RESOURCE_IDS);
    expect(problems).toContain('opening: a present must not hold another present');
    expect(problems).toContain('fixed.24: unknown item "not-a-thing"');
    expect(problems.some((p) => p.startsWith('opening: fewer items'))).toBe(true);
    // Fixed days are keyed as the roll looks them up: '9', never '09'.
    const padded = { ...ADVENT_PRESENTS, fixed: { '09': { pies: 1 } } };
    expect(checkAdventPresents(padded, RESOURCE_IDS)).not.toEqual([]);
  });

  it('is the same for the same Keeper and day, and differs between them', () => {
    const a = rollAdventPresent(ADVENT_PRESENTS, ALICE, '2026-12-05');
    expect(rollAdventPresent(ADVENT_PRESENTS, ALICE, '2026-12-05')).toEqual(a);
    const days = adventDaysOf(2026);
    const alice = days.map((d) => JSON.stringify(rollAdventPresent(ADVENT_PRESENTS, ALICE, d)));
    const bob = days.map((d) => JSON.stringify(rollAdventPresent(ADVENT_PRESENTS, BOB, d)));
    expect(alice).not.toEqual(bob);
    expect(new Set(alice).size).toBeGreaterThan(5);
    expect(adventSeed(ADVENT_PRESENTS, ALICE, '2026-12-05')).not.toBe(
      adventSeed(ADVENT_PRESENTS, ALICE, '2026-12-06'),
    );
  });

  it('every present holds something real, only from its contents list', () => {
    for (const user of [ALICE, BOB]) {
      for (const day of adventDaysOf(2026)) {
        const items = rollAdventPresent(ADVENT_PRESENTS, user, day);
        expect(AdventResultSchema.safeParse(items).success).toBe(true);
        const contents = adventContents(ADVENT_PRESENTS, day);
        for (const id of Object.keys(items)) expect(contents).toContain(id);
      }
    }
  });

  it('holds Fireworks on the 24th, always', () => {
    for (const user of [ALICE, BOB]) {
      expect(rollAdventPresent(ADVENT_PRESENTS, user, '2026-12-24')['fireworks']).toBeGreaterThan(
        0,
      );
    }
    expect(adventContents(ADVENT_PRESENTS, '2026-12-24')).toContain('fireworks');
    expect(adventContents(ADVENT_PRESENTS, '2026-12-23')).not.toContain('fireworks');
  });

  it('sometimes brings a present to pass on', () => {
    const spares = adventDaysOf(2026).filter(
      (d) => (rollAdventPresent(ADVENT_PRESENTS, ALICE, d)[PRESENT_ITEM] ?? 0) > 0,
    );
    expect(spares.length).toBeGreaterThan(0);
    expect(spares.length).toBeLessThan(25);
  });

  it('a present opened from the bag holds something, never another present', () => {
    for (let i = 0; i < 50; i += 1) {
      const items = rollPresentOpening(ADVENT_PRESENTS, ALICE, `opening-${String(i)}`);
      expect(AdventResultSchema.safeParse(items).success).toBe(true);
      expect(items[PRESENT_ITEM]).toBeUndefined();
    }
    const can = presentContents(ADVENT_PRESENTS);
    for (let i = 0; i < 50; i += 1) {
      for (const id of Object.keys(rollPresentOpening(ADVENT_PRESENTS, BOB, `o-${String(i)}`))) {
        expect(can).toContain(id);
      }
    }
    expect(rollPresentOpening(ADVENT_PRESENTS, ALICE, 'x')).toEqual(
      rollPresentOpening(ADVENT_PRESENTS, ALICE, 'x'),
    );
  });

  it('lists contents without any odds', () => {
    const contents = adventContents(ADVENT_PRESENTS, '2026-12-01');
    expect(contents.every((id) => typeof id === 'string')).toBe(true);
    expect(JSON.stringify(contents)).not.toMatch(/weight|seed|salt/);
  });
});
