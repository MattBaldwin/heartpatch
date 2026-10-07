import { findAvoidedWords, hexKey, type LandTending } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  LAND_TEXT,
  landFade,
  landMarks,
  latestWildNight,
  rippleFade,
  unseenLostFires,
  unseenWild,
} from './land-text.js';

const ME = '0190a8c4-0000-7000-8000-000000000301';
const tending = (extra: Partial<LandTending> = {}): LandTending => ({
  missing: [],
  wentWild: [],
  nextMissesYouAt: null,
  now: '2026-10-20T03:00:00.000Z',
  ...extra,
});
const WILD_FROM = '2026-10-25T03:00:00.000Z';

describe('land that misses you: words', () => {
  it('stays cozy and kid-safe', () => {
    const lines = [
      LAND_TEXT.chip,
      LAND_TEXT.visit,
      LAND_TEXT.happy,
      LAND_TEXT.missesTitle,
      LAND_TEXT.missesLine,
      LAND_TEXT.wildTitle,
      LAND_TEXT.wildLine,
      LAND_TEXT.welcomeTitle,
      LAND_TEXT.welcomeLine(1),
      LAND_TEXT.welcomeLine(12),
      LAND_TEXT.welcomeClaim(1),
      LAND_TEXT.welcomeClaim(12),
      LAND_TEXT.ok,
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
  });

  it('counts land in kid words', () => {
    expect(LAND_TEXT.welcomeLine(1)).toBe('While you were away, 1 bit of land went wild again.');
    expect(LAND_TEXT.welcomeLine(12)).toBe('While you were away, 12 bits of land went wild again.');
    expect(LAND_TEXT.welcomeClaim(12)).toBe('Their guardians are back. You can claim them again!');
  });
});

describe('marks and fade', () => {
  it('marks fading land 💛 then 🍂, and land gone wild 🌱 while it stays wild', () => {
    const t = tending({
      missing: [
        { q: 3, r: 0, fade: 10, wildFrom: WILD_FROM },
        { q: 4, r: 0, fade: 70, wildFrom: WILD_FROM },
      ],
      wentWild: [
        { q: 5, r: 0, night: '2026-10-14', lostFire: null },
        { q: 6, r: 0, night: '2026-10-14', lostFire: null },
      ],
    });
    const tiles = [
      { q: 3, r: 0, ownerUserId: ME },
      { q: 4, r: 0, ownerUserId: ME },
      { q: 5, r: 0, ownerUserId: null },
      { q: 6, r: 0, ownerUserId: '0190a8c4-0000-7000-8000-000000000302' },
    ];
    const marks = landMarks(t, tiles);
    expect(marks.get(hexKey({ q: 3, r: 0 }))).toBe('💛');
    expect(marks.get(hexKey({ q: 4, r: 0 }))).toBe('🍂');
    expect(marks.get(hexKey({ q: 5, r: 0 }))).toBe('🌱');
    // A rival claimed it since: no sprout.
    expect(marks.has(hexKey({ q: 6, r: 0 }))).toBe(false);
    expect(landMarks(null, tiles).size).toBe(0);
  });

  it('draws some fade from the first day land misses me, up to all of it', () => {
    const fade = landFade(
      tending({
        missing: [
          { q: 3, r: 0, fade: 0, wildFrom: WILD_FROM },
          { q: 4, r: 0, fade: 100, wildFrom: WILD_FROM },
        ],
      }),
    );
    expect(fade.get(hexKey({ q: 3, r: 0 }))).toBeGreaterThan(0);
    expect(fade.get(hexKey({ q: 4, r: 0 }))).toBe(1);
    expect(landFade(null).size).toBe(0);
  });

  it('brings the colour back outward from home, nearest first', () => {
    const near = { q: 3, r: 0 };
    const far = { q: 6, r: 0 };
    const from = new Map([
      [hexKey(near), 1],
      [hexKey(far), 1],
    ]);
    const home = { q: 0, r: 0 };
    const mid = rippleFade(from, [near, far], home, 450, 900);
    expect(mid.get(hexKey(near)) ?? 0).toBeLessThan(mid.get(hexKey(far)) ?? 0);
    expect(rippleFade(from, [near, far], home, 0, 900).get(hexKey(far))).toBe(1);
    expect(rippleFade(from, [near, far], home, 900, 900).size).toBe(0);
  });
});

describe('fires that went out with the land (#202)', () => {
  it('counts my fires lost since the card I last saw, and adds up what came back', () => {
    const t = tending({
      wentWild: [
        { q: 5, r: 0, night: '2026-10-14', lostFire: { timber: 2, stone: 2, emberwood: 1 } },
        { q: 6, r: 0, night: '2026-10-15', lostFire: { timber: 2, stone: 2 } },
        { q: 7, r: 0, night: '2026-10-15', lostFire: null },
      ],
    });
    expect(unseenLostFires(t, null)).toEqual({
      fires: 2,
      back: { timber: 4, stone: 4, emberwood: 1 },
    });
    expect(unseenLostFires(t, '2026-10-14')).toEqual({ fires: 1, back: { timber: 2, stone: 2 } });
    expect(unseenLostFires(t, '2026-10-15').fires).toBe(0);
    expect(LAND_TEXT.welcomeFire(1)).toBe(
      'Your fire out there went out when the land went wild. You got some things back 🔥',
    );
    for (const n of [1, 2]) expect(findAvoidedWords(LAND_TEXT.welcomeFire(n))).toEqual([]);
  });
});

describe('the welcome-back card', () => {
  const t = tending({
    wentWild: [
      { q: 5, r: 0, night: '2026-10-14', lostFire: null },
      { q: 6, r: 0, night: '2026-10-15', lostFire: null },
    ],
  });

  it('tells only land that went wild after the night I last saw', () => {
    expect(unseenWild(t, null)).toBe(2);
    expect(unseenWild(t, '2026-10-14')).toBe(1);
    expect(unseenWild(t, '2026-10-15')).toBe(0);
    expect(latestWildNight(t)).toBe('2026-10-15');
    expect(latestWildNight(null)).toBeNull();
  });
});
