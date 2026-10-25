import { describe, expect, it } from 'vitest';
import { TERRITORY_RULES } from '../data/territory.js';
import { checkTerritoryRules } from '../schemas/data/territory.js';
import {
  canFade,
  clockFadePercent,
  clockMood,
  fadeClock,
  fadePercent,
  landMood,
  missesYouAt,
  strandedClock,
  tendingClock,
  tilesGoingWild,
  wildFrom,
  wildPerNight,
  type TendingTile,
} from './index.js';

const RULES = {
  missesYouAfterDays: 5,
  wildAfterDays: 8,
  wildPerNight: { off: 3, on: 3, gentle: 2 },
  keepRadius: 2,
};
const NOW = new Date('2026-10-20T21:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('land that misses you: rules', () => {
  it('accepts the shipped tending rules and refuses a wild time with no warning first', () => {
    expect(checkTerritoryRules(TERRITORY_RULES)).toEqual([]);
    const tending = { ...TERRITORY_RULES.tending, wildAfterDays: 5, missesYouAfterDays: 5 };
    expect(checkTerritoryRules({ ...TERRITORY_RULES, tending }).join()).toMatch(/wildAfterDays/);
  });

  it('keeps Gentle at most as fast as On', () => {
    const { wildPerNight: perNight } = TERRITORY_RULES.tending;
    expect(perNight.gentle).toBeLessThanOrEqual(perNight.on);
  });
});

describe('landMood', () => {
  it('is happy, then misses you, then is going wild', () => {
    expect(landMood(daysAgo(0), NOW, RULES)).toBe('happy');
    expect(landMood(daysAgo(4.99), NOW, RULES)).toBe('happy');
    expect(landMood(daysAgo(5), NOW, RULES)).toBe('misses-you');
    expect(landMood(daysAgo(7.99), NOW, RULES)).toBe('misses-you');
    expect(landMood(daysAgo(8), NOW, RULES)).toBe('going-wild');
  });

  it('gives the times the client counts down to', () => {
    expect(missesYouAt(daysAgo(1), RULES).toISOString()).toBe(daysAgo(-4).toISOString());
    expect(wildFrom(daysAgo(1), RULES).toISOString()).toBe(daysAgo(-7).toISOString());
  });

  it('fades from 0 to 100 across the warning days', () => {
    expect(fadePercent(daysAgo(2), NOW, RULES)).toBe(0);
    expect(fadePercent(daysAgo(5), NOW, RULES)).toBe(0);
    expect(fadePercent(daysAgo(6.5), NOW, RULES)).toBe(50);
    expect(fadePercent(daysAgo(9), NOW, RULES)).toBe(100);
  });
});

describe('which tiles can fade', () => {
  const seed = { q: 0, r: 0 };

  it('never fades home tiles or the ring round the Heart Seed', () => {
    expect(canFade({ q: 0, r: 0, homeSlot: 0 }, seed, RULES)).toBe(false);
    expect(canFade({ q: 1, r: 0, homeSlot: 0 }, seed, RULES)).toBe(false);
    expect(canFade({ q: 2, r: 0, homeSlot: null }, seed, RULES)).toBe(false);
    expect(canFade({ q: 3, r: 0, homeSlot: null }, seed, RULES)).toBe(true);
  });

  it('fades any outer tile when the owner has no Heart Seed', () => {
    expect(canFade({ q: 1, r: 0, homeSlot: null }, null, RULES)).toBe(true);
  });

  it('lets Gentle mode go slower', () => {
    expect(wildPerNight(RULES, 'gentle')).toBe(2);
    expect(wildPerNight(RULES, 'on')).toBe(3);
  });
});

describe('tilesGoingWild', () => {
  const seeds = new Map([
    ['me', { q: 0, r: 0 }],
    ['you', { q: 10, r: 0 }],
  ]);
  const t = (q: number, r: number, ownerUserId: string, days: number): TendingTile => ({
    q,
    r,
    ownerUserId,
    homeSlot: null,
    tendedAt: daysAgo(days),
  });

  it('picks only untended tiles, farthest from home first, a few per owner', () => {
    const tiles = [
      t(3, 0, 'me', 9), // distance 3
      t(5, 0, 'me', 9), // distance 5
      t(4, 0, 'me', 20), // distance 4
      t(6, 0, 'me', 7), // still only missing me
      t(2, 0, 'me', 30), // kept ring
      t(6, -1, 'you', 9), // distance 4 from yours
    ];
    const going = tilesGoingWild(tiles, seeds, NOW, 2, RULES);
    expect(going.map((g) => `${g.ownerUserId}:${String(g.q)},${String(g.r)}`)).toEqual([
      'me:5,0',
      'me:4,0',
      'you:6,-1',
    ]);
  });

  it('breaks ties by the longest untended, then by position', () => {
    const tiles = [t(0, 4, 'me', 9), t(4, 0, 'me', 12), t(-4, 0, 'me', 9)];
    const going = tilesGoingWild(tiles, seeds, NOW, 3, RULES);
    expect(going.map((g) => [g.q, g.r])).toEqual([
      [4, 0],
      [-4, 0],
      [0, 4],
    ]);
  });

  it('takes nothing from a tended patch', () => {
    expect(tilesGoingWild([t(5, 0, 'me', 1)], seeds, NOW, 3, RULES)).toEqual([]);
  });
});

describe('stranded land (Wild Isle, #621)', () => {
  const STRANDED = { afterHours: 36, graceHoursAfterBridgeLoss: 12 };
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
  const seeds = new Map([['me', { q: 0, r: 0 }]]);
  const t = (q: number, days: number, strandedSince: Date | null = null): TendingTile => ({
    q,
    r: 0,
    ownerUserId: 'me',
    homeSlot: null,
    tendedAt: daysAgo(days),
    strandedSince,
  });

  it('fades at once and goes wild `afterHours` later', () => {
    const clock = strandedClock(hoursAgo(0), STRANDED);
    expect(clock.stranded).toBe(true);
    expect(clockMood(clock, NOW)).toBe('misses-you');
    expect(clockMood(strandedClock(hoursAgo(35.9), STRANDED), NOW)).toBe('misses-you');
    expect(clockMood(strandedClock(hoursAgo(36), STRANDED), NOW)).toBe('going-wild');
    expect(clockFadePercent(strandedClock(hoursAgo(18), STRANDED), NOW)).toBe(50);
  });

  it('a lost bridge’s grace keeps it happy until stranding starts', () => {
    const since = new Date(NOW.getTime() + STRANDED.graceHoursAfterBridgeLoss * 3_600_000);
    expect(clockMood(strandedClock(since, STRANDED), NOW)).toBe('happy');
  });

  it('fades by whichever clock ends first', () => {
    // Untended 7 days (wild in 1 day) and stranded 1 hour (wild in 35 h): tending wins.
    const tending = fadeClock(daysAgo(7), hoursAgo(1), RULES, STRANDED);
    expect(tending.stranded).toBe(false);
    // Tended yesterday, stranded 30 h ago (wild in 6 h): stranded wins.
    const cutOff = fadeClock(daysAgo(1), hoursAgo(30), RULES, STRANDED);
    expect(cutOff.stranded).toBe(true);
    expect(clockMood(cutOff, NOW)).toBe('misses-you');
    // No stranded rules (a Cozy Patch) or not stranded: the tending clock.
    expect(fadeClock(daysAgo(1), hoursAgo(30), RULES, null)).toEqual(
      tendingClock(daysAgo(1), RULES),
    );
    expect(fadeClock(daysAgo(1), null, RULES, STRANDED)).toEqual(tendingClock(daysAgo(1), RULES));
  });

  it('keeps landMood and fadePercent what they were', () => {
    for (const days of [0, 4.99, 5, 6.5, 7.99, 8, 9]) {
      const clock = tendingClock(daysAgo(days), RULES);
      expect(clockMood(clock, NOW)).toBe(landMood(daysAgo(days), NOW, RULES));
      expect(clockFadePercent(clock, NOW)).toBe(fadePercent(daysAgo(days), NOW, RULES));
    }
  });

  it('picks stranded land with untended land under the same cap, farthest first', () => {
    const tiles = [
      t(3, 9), // untended, distance 3
      t(5, 1, hoursAgo(40)), // stranded long enough, distance 5
      t(6, 1, hoursAgo(10)), // stranded, not long enough
      t(4, 1, hoursAgo(50)), // stranded, distance 4
      t(2, 1, hoursAgo(50)), // the kept ring never strands
    ];
    const going = tilesGoingWild(tiles, seeds, NOW, 2, RULES, STRANDED);
    expect(going.map((g) => g.q)).toEqual([5, 4]);
    expect(tilesGoingWild(tiles, seeds, NOW, 5, RULES, STRANDED).map((g) => g.q)).toEqual([
      5, 4, 3,
    ]);
  });

  it('never strands on a Cozy Patch (no stranded rules)', () => {
    const tiles = [t(5, 1, hoursAgo(400)), t(4, 1, hoursAgo(400))];
    expect(tilesGoingWild(tiles, seeds, NOW, 3, RULES)).toEqual([]);
  });
});
