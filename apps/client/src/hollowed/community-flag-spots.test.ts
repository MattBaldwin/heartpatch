import { describe, expect, it } from 'vitest';
import { FLAG_GAP_PX, flagSpot, freeFlagSpot, placeFlags } from '../trading/flag-spot.js';
import { intersects, type Rect } from '../ui/geometry.js';

// Village flags (#306) share the trading posts' flag room: they keep clear
// of what's over the map and of every flag placed before them, moving to the
// nearest free spot instead of overlapping. An iPhone SE in portrait.

const flag = { width: 120, height: 26 };
const se = { width: 375, height: 667, top: 60, covers: [] as Rect[] };
const tile = (x: number, y: number) => ({ x, y, width: 40, height: 30 });
const boxAt = (spot: { x: number; y: number }, size = flag): Rect => ({
  x: spot.x - size.width / 2,
  y: spot.y - size.height,
  width: size.width,
  height: size.height,
});

/** What's over the map on an SE at night: the patch name, the night's chips, the tray handles. */
const OVER_MAP: readonly Rect[] = [
  // The patch name pill, top middle.
  { x: 121, y: 64, width: 133, height: 44 },
  // "He's watching tonight" and friends, bottom middle.
  { x: 40, y: 615, width: 295, height: 36 },
  // The Adventure and Home tray handles, middle of each side.
  { x: 0, y: 317, width: 40, height: 100 },
  { x: 335, y: 317, width: 40, height: 100 },
];

describe('freeFlagSpot', () => {
  it('sits over its tile like any flag when that is free', () => {
    expect(freeFlagSpot(tile(180, 300), flag, se)).toEqual(flagSpot(tile(180, 300), flag, se));
  });

  it('stacks a row up rather than hide when over and under are taken', () => {
    const over = boxAt({ x: 200, y: 300 });
    const under = boxAt({ x: 200, y: 356 });
    const spot = freeFlagSpot(tile(180, 300), flag, { ...se, covers: [over, under] });
    expect(spot).toEqual({ x: 200, y: 300 - flag.height - FLAG_GAP_PX });
  });

  it('slides sideways by half its width when the rows above and below are taken', () => {
    const column = { x: 140, y: 60, width: 120, height: 607 };
    const spot = freeFlagSpot(tile(180, 300), flag, { ...se, covers: [column] });
    expect(spot).not.toBeNull();
    if (!spot) return;
    expect(intersects(boxAt(spot), column)).toBe(false);
    expect(Math.abs(spot.x - 200)).toBeLessThanOrEqual(flag.width);
  });

  it('still hides with its tile off screen or under the top bar', () => {
    expect(freeFlagSpot(null, flag, se)).toBeNull();
    expect(freeFlagSpot(tile(-60, 300), flag, se)).toBeNull();
    expect(freeFlagSpot(tile(180, 20), flag, se)).toBeNull();
  });

  it('hides rather than wander far when everything near is covered', () => {
    const sheet = { x: 0, y: 150, width: 375, height: 400 };
    expect(freeFlagSpot(tile(180, 300), flag, { ...se, covers: [sheet] })).toBeNull();
  });
});

describe('placeFlags', () => {
  it('puts flags on the same tile one under and one over, never on top', () => {
    const spots = placeFlags(
      [0, 1, 2].map(() => ({ tile: tile(180, 300), size: flag })),
      se,
    );
    expect(spots.every((s) => s !== null)).toBe(true);
    const boxes = spots.flatMap((s) => (s ? [boxAt(s)] : []));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(intersects(a, b)).toBe(false);
    }
  });

  it('keeps many flags clear of each other and of everything over the map', () => {
    // Posts, homes and villages scattered as a busy 6-seat patch zoomed out
    // shows them: a seeded scatter, the same every run, clustered in the middle.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 20; round++) {
      const flags = Array.from({ length: 16 }, (_, i) => ({
        tile: tile(20 + next() * 320, 70 + next() * 560),
        size: { width: 90 + 2 * Math.round(next() * 55) + (i % 3) * 10, height: 24 + (i % 2) * 2 },
      }));
      const spots = placeFlags(flags, { ...se, covers: [...OVER_MAP] });
      const shown = spots.flatMap((s, i) => {
        const size = flags[i]?.size;
        return s && size ? [boxAt(s, size)] : [];
      });
      // Crowded, but most still find a spot.
      expect(shown.length).toBeGreaterThanOrEqual(8);
      for (const [i, a] of shown.entries()) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x + a.width).toBeLessThanOrEqual(se.width);
        expect(a.y).toBeGreaterThanOrEqual(se.top);
        expect(a.y + a.height).toBeLessThanOrEqual(se.height);
        for (const cover of OVER_MAP) expect(intersects(a, cover)).toBe(false);
        for (const b of shown.slice(i + 1)) {
          expect(intersects(a, b)).toBe(false);
          // And never touching: a gap between pills.
          const roomy = {
            x: b.x - FLAG_GAP_PX,
            y: b.y - FLAG_GAP_PX,
            width: b.width + FLAG_GAP_PX * 2,
            height: b.height + FLAG_GAP_PX * 2,
          };
          expect(intersects(a, roomy)).toBe(false);
        }
      }
    }
  });

  it('places in order: the flags before it keep their spots', () => {
    const post = { tile: tile(180, 300), size: flag };
    const [alone] = placeFlags([post], se);
    const [first, village] = placeFlags([post, { tile: tile(185, 305), size: flag }], se);
    expect(first).toEqual(alone);
    expect(village).not.toEqual(first);
  });
});
