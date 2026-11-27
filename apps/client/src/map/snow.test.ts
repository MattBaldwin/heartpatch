import { describe, expect, it } from 'vitest';
import { DRIFT_MODE, moteShare, motesFor } from './ambient-layout.js';
import { CHRISTMAS, HEX_SIZE, MOTES, SKY_BACKDROP, THANKSGIVING } from './map-config.js';
import {
  firstSnowKey,
  firstSnowNow,
  hexRgb,
  isChristmas,
  isHalloween,
  snowCoverAt,
  snowGroundRgb,
  snowLight,
  snowSeasonYear,
  tileColor,
  type Rgb,
} from './map-dressing.js';
import { skyLook } from './map-ambient.js';
import { testView } from './test-view.js';

// Christmas snow on every patch (#37): the look by season, day and night, the
// first snow's fade (and reduced motion's snap), and the mote swap.

const FLAT = { brightness: 1, warmth: 0, height: 0 };
const MEADOW = '#c2eaa6';
const LAKE = '#9fd6f5';
const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('Christmas is on by the season windows (shared activeSeasons, no dates in code)', () => {
  it('is on in December and off in November, and never with Halloween', () => {
    const zone = 'America/New_York';
    expect(isChristmas(zone, new Date('2026-12-05T15:00:00Z'))).toBe(true);
    expect(isChristmas(zone, new Date('2026-11-20T15:00:00Z'))).toBe(false);
    expect(isChristmas(zone, new Date('2026-10-31T15:00:00Z'))).toBe(false);
    expect(isHalloween(zone, new Date('2026-12-05T15:00:00Z'))).toBe(false);
  });
});

describe('snow tile colours (#37)', () => {
  it('changes nothing outside the season (no snow argument, or none faded in)', () => {
    const today = tileColor(MEADOW, FLAT, false);
    expect(tileColor(MEADOW, FLAT, false, undefined)).toEqual(today);
    expect(tileColor(MEADOW, FLAT, false, { terrain: 'meadow', cover: 0 })).toEqual(today);
    expect(tileColor(MEADOW, FLAT, true, { terrain: 'meadow', cover: 0 })).toEqual(
      tileColor(MEADOW, FLAT, true),
    );
  });

  it('turns land white, wild land cooler and whiter than owned land, which keeps more of itself', () => {
    const wild = tileColor(MEADOW, FLAT, true, { terrain: 'meadow', cover: 1 });
    const owned = tileColor(MEADOW, FLAT, false, { terrain: 'meadow', cover: 1 });
    expect(lum(wild)).toBeGreaterThan(0.9);
    expect(lum(owned)).toBeGreaterThan(lum(tileColor(MEADOW, FLAT, false)));
    // Owned is warmer (more red than blue); wild is cool (blue at least red).
    expect(owned[0]).toBeGreaterThan(owned[2]);
    expect(wild[2]).toBeGreaterThanOrEqual(wild[0] - 0.01);
    // Ownership still reads.
    expect(dist(wild, owned)).toBeGreaterThan(0.05);
  });

  it('snows every land terrain, Wild Isle coast too, and leaves Juniper’s Gap glowing', () => {
    for (const terrain of Object.keys(CHRISTMAS.cover)) {
      const before = tileColor(MEADOW, FLAT, true);
      const after = tileColor(MEADOW, FLAT, true, { terrain, cover: 1 });
      expect(lum(after), terrain).toBeGreaterThan(lum(before));
    }
    expect(CHRISTMAS.cover['coast']).toBeGreaterThan(0);
    const gap = '#e6b8ff';
    expect(tileColor(gap, FLAT, false, { terrain: 'junipers-gap', cover: 1 })).toEqual(
      tileColor(gap, FLAT, false),
    );
  });

  it('frosts lakes and rivers a pale blue instead of snow', () => {
    for (const terrain of ['lake', 'wild-lake', 'river']) {
      const c = tileColor(LAKE, FLAT, false, { terrain, cover: 1 });
      expect(c[2], terrain).toBeGreaterThan(c[0]);
      expect(lum(c), terrain).toBeGreaterThan(lum(hexRgb(LAKE)));
      expect(lum(c), terrain).toBeLessThan(lum(hexRgb(CHRISTMAS.wild)));
    }
  });

  it('snows the island ground off the map, grass more than the beach', () => {
    const grass = hexRgb('#a9d897');
    const snowed = snowGroundRgb(grass, 'grass', 1);
    expect(lum(snowed)).toBeGreaterThan(0.85);
    expect(snowGroundRgb(grass, 'grass', 0)).toEqual(grass);
    const sand = hexRgb('#f2dfb0');
    expect(dist(snowGroundRgb(sand, 'beach', 1), sand)).toBeLessThan(
      dist(snowGroundRgb(sand, 'grass', 1), sand),
    );
  });

  it('goes part of the way while the first snow fades in', () => {
    const none = tileColor(MEADOW, FLAT, true);
    const half = tileColor(MEADOW, FLAT, true, { terrain: 'meadow', cover: 0.5 });
    const full = tileColor(MEADOW, FLAT, true, { terrain: 'meadow', cover: 1 });
    expect(lum(half)).toBeGreaterThan(lum(none));
    expect(lum(half)).toBeLessThan(lum(full));
  });
});

describe('the snow uniform by day and night (#37)', () => {
  it('lifts the snow in moonlight at night only, as far as it has faded in', () => {
    expect(snowLight(1, false)).toEqual({ cover: 1, lift: 0 });
    expect(snowLight(1, true)).toEqual({ cover: 1, lift: CHRISTMAS.night.lift });
    expect(snowLight(0.5, true).lift).toBeCloseTo(CHRISTMAS.night.lift / 2);
    expect(snowLight(0, true)).toEqual({ cover: 0, lift: 0 });
    // The moon is cool: blue at least as strong as red.
    expect(CHRISTMAS.night.moon[2]).toBeGreaterThanOrEqual(CHRISTMAS.night.moon[0]);
  });

  it('paints a snowy sky by day and a moonlit blue one at night; other seasons keep theirs', () => {
    const on = { halloween: false, thanksgiving: false, christmas: true };
    expect(skyLook({ ...on, night: false })).toBe(CHRISTMAS.sky.day);
    expect(skyLook({ ...on, night: true })).toBe(CHRISTMAS.sky.night);
    const off = { halloween: false, thanksgiving: false, christmas: false };
    expect(skyLook({ ...off, night: false })).toBe(SKY_BACKDROP.day);
    expect(skyLook({ ...off, night: true })).toBe(SKY_BACKDROP.night);
    expect(skyLook({ ...off, thanksgiving: true, night: false })).toBe(THANKSGIVING.day);
    expect(skyLook({ ...off, halloween: true, night: true })).toBe(SKY_BACKDROP.halloweenNight);
    // The night sky stays a deep, magical blue (blue over red), never washed out.
    const night = hexRgb(CHRISTMAS.sky.night.mid);
    expect(night[2]).toBeGreaterThan(night[0]);
    expect(lum(night)).toBeLessThan(0.3);
  });
});

describe('the first snow fade (#37)', () => {
  it('fades in over CHRISTMAS.fadeMs from the first open, eased, then stays', () => {
    const fade = { startMs: 1000 };
    expect(snowCoverAt(fade, 1000, false)).toBe(0);
    const mid = snowCoverAt(fade, 1000 + CHRISTMAS.fadeMs / 2, false);
    expect(mid).toBeCloseTo(0.5);
    expect(snowCoverAt(fade, 1000 + CHRISTMAS.fadeMs / 4, false)).toBeLessThan(0.25);
    expect(snowCoverAt(fade, 1000 + CHRISTMAS.fadeMs, false)).toBe(1);
    expect(snowCoverAt(fade, 1000 + CHRISTMAS.fadeMs * 9, false)).toBe(1);
  });

  it('snaps under reduced motion, and is just there once seen', () => {
    expect(snowCoverAt({ startMs: 1000 }, 1000, true)).toBe(1);
    expect(snowCoverAt(null, 0, false)).toBe(1);
  });

  it('plays once a season per account on this device; keyed by the shared season run year', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(snowSeasonYear('2026-12-01')).toBe('2026');
    expect(snowSeasonYear('2026-12-31')).toBe('2026');
    expect(firstSnowNow(storage, '2026', 'me')).toBe(true);
    expect(firstSnowNow(storage, '2026', 'me')).toBe(false);
    expect(store.get(firstSnowKey('2026', 'me'))).toBe('1');
    expect(firstSnowNow(storage, '2026', 'you')).toBe(true);
    expect(firstSnowNow(storage, '2027', 'me')).toBe(true);
    // No storage or signed out: no fade (never every open).
    expect(firstSnowNow(null, '2026', 'me')).toBe(false);
    expect(firstSnowNow(storage, '2026', null)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('private');
      },
      setItem: () => undefined,
    };
    expect(firstSnowNow(throwing, '2026', 'me')).toBe(false);
  });
});

describe('snowfall motes (#37)', () => {
  const { tiles } = testView();
  it('fall in their own drift mode over land, never water or home, capped 120 / 60 / 0 by tier', () => {
    const snow = motesFor('snow', tiles, HEX_SIZE);
    expect(snow.length).toBe(MOTES.snow.max);
    expect(MOTES.snow.max).toBe(120);
    expect(Math.round(snow.length * moteShare('medium'))).toBe(60);
    expect(Math.round(snow.length * moteShare('low'))).toBe(0);
    for (const m of snow) expect(m.drift[0]).toBe(DRIFT_MODE.snowfall);
  });

  it('has a drift mode of its own, after every other', () => {
    const modes = Object.values(DRIFT_MODE);
    expect(new Set(modes).size).toBe(modes.length);
    expect(DRIFT_MODE.snowfall).toBe(Math.max(...modes));
  });
});
