import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '@heartpatch/shared';
import {
  FAR_HOLLOW_TERRAIN_EMOJI,
  FAR_HOLLOW_TEXT,
  farHollowProgress,
  farHollowSpots,
  farHollowState,
  freshLine,
  justArrived,
  shortDate,
} from './far-hollow-model.js';

describe('the far Hollow sheet model (#306 PR 6)', () => {
  it('knows whether I am away, there, or done', () => {
    expect(farHollowState({ arrived: false, completedAt: null })).toBe('away');
    expect(farHollowState({ arrived: true, completedAt: null })).toBe('arrived');
    expect(farHollowState({ arrived: true, completedAt: '2026-11-04T16:00:00.000Z' })).toBe(
      'complete',
    );
  });

  it('knows I only just arrived, so a journey of unknown origin was the far road', () => {
    const tiles = [
      { searched: 0, total: 8 },
      { searched: 0, total: 9 },
    ];
    expect(justArrived({ arrived: true, completedAt: null, tiles })).toBe(true);
    expect(justArrived({ arrived: false, completedAt: null, tiles })).toBe(false);
    expect(
      justArrived({ arrived: true, completedAt: null, tiles: [{ searched: 1, total: 8 }] }),
    ).toBe(false);
    expect(justArrived({ arrived: true, completedAt: '2026-11-04T16:00:00.000Z', tiles: [] })).toBe(
      false,
    );
  });

  it('adds up every tile', () => {
    expect(
      farHollowProgress([
        { searched: 2, total: 8 },
        { searched: 8, total: 8 },
      ]),
    ).toEqual({ searched: 10, total: 16 });
    expect(farHollowProgress([])).toEqual({ searched: 0, total: 0 });
  });

  it('says when a fresh one comes', () => {
    expect(shortDate('2026-12-01')).toBe('Dec 1');
    expect(shortDate('2027-10-01')).toBe('Oct 1');
    expect(freshLine({ id: 'christmas', name: 'Christmas', startsOn: '2026-12-01' })).toBe(
      'A fresh far Hollow comes with Christmas on Dec 1 ✨',
    );
    expect(freshLine(null)).toBe(FAR_HOLLOW_TEXT.freshSoon);
  });

  it('lays the tiles out as their hexes, inside the box, middle in the middle', () => {
    const ring = [
      { index: 0, q: 0, r: 0 },
      { index: 1, q: 1, r: 0 },
      { index: 2, q: 1, r: -1 },
      { index: 3, q: 0, r: -1 },
      { index: 4, q: -1, r: 0 },
      { index: 5, q: -1, r: 1 },
      { index: 6, q: 0, r: 1 },
    ];
    const { spots, aspect } = farHollowSpots(ring);
    expect(spots[0]).toEqual({ index: 0, left: 50, top: 50 });
    for (const s of spots) {
      expect(s.left).toBeGreaterThan(0);
      expect(s.left).toBeLessThan(100);
      expect(s.top).toBeGreaterThan(0);
      expect(s.top).toBeLessThan(100);
    }
    // Opposite neighbours sit opposite the middle.
    expect(spots[1]!.left + spots[4]!.left).toBeCloseTo(100, 0);
    expect(spots[1]!.top + spots[4]!.top).toBeCloseTo(100, 0);
    expect(aspect).toBeGreaterThan(0.8);
    expect(aspect).toBeLessThan(1.3);
    // Three rows 1.5 apart, plus a half tile (1) top and bottom: a tile (2 tall) is 2 of 5.
    expect(farHollowSpots(ring).tile.height).toBe(40);
    expect(farHollowSpots([])).toEqual({ spots: [], aspect: 1, tile: { width: 0, height: 0 } });
  });

  it('has a picture for every terrain a far Hollow can have', () => {
    for (const { terrain } of COMMUNITY_RULES.farHollow.terrains) {
      expect(FAR_HOLLOW_TERRAIN_EMOJI[terrain]).toBeDefined();
    }
  });

  it('keeps the words kind and short', () => {
    expect(FAR_HOLLOW_TEXT.title('The far Hollow')).toBe('The far Hollow 🕯️');
    // Patch › Town › Hollow: never "village" or "community" in player text.
    const words = [
      ...Object.values(FAR_HOLLOW_TEXT).flatMap((w) => (typeof w === 'string' ? [w] : [])),
      FAR_HOLLOW_TEXT.title('The far Hollow'),
      FAR_HOLLOW_TEXT.kicker('Christmas'),
      FAR_HOLLOW_TEXT.road(3, 16),
      FAR_HOLLOW_TEXT.progress(12, 86),
      FAR_HOLLOW_TEXT.tileLabel('Meadow', 2, 10),
      FAR_HOLLOW_TEXT.fresh('Christmas', 'Dec 1'),
    ];
    for (const line of words) {
      expect(line).not.toMatch(/village|community/i);
      expect(line.length).toBeLessThan(140);
    }
  });
});
