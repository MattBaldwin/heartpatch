import { describe, expect, it } from 'vitest';
import { nearbyNote, tilesToMark, WildHintTiles, WILD_TEXT } from './wild-pick.js';

describe('nearbyNote', () => {
  it('counts the tufts and points at them (owner decision 2026-10-07)', () => {
    expect(nearbyNote(6)).toBe('6 nearby! Or tap a rustle to pick.');
    expect(nearbyNote(1)).toBe('1 nearby! Or tap a rustle to pick.');
  });

  it('says so kindly when nobody is around', () => {
    expect(nearbyNote(0)).toBe('No wild squishies nearby right now.');
  });

  it('keeps every line short and kid-readable (style guide §2)', () => {
    for (const text of [WILD_TEXT.rustling, WILD_TEXT.meet, WILD_TEXT.none, nearbyNote(12)]) {
      expect(text.split(' ').length).toBeLessThanOrEqual(8);
    }
  });
});

describe('WildHintTiles', () => {
  it('offers Meet it on exactly the hinted tiles of the map on screen', () => {
    const hints = new WildHintTiles();
    hints.set('map-a', [
      { q: 1, r: 2 },
      { q: -3, r: 0 },
    ]);
    expect(hints.has('map-a', { q: 1, r: 2 })).toBe(true);
    expect(hints.has('map-a', { q: -3, r: 0 })).toBe(true);
    expect(hints.has('map-a', { q: 0, r: 0 })).toBe(false);
    expect(hints.count).toBe(2);
  });

  it('never matches another map’s tiles, or after the map goes away', () => {
    const hints = new WildHintTiles();
    hints.set('map-a', [{ q: 1, r: 2 }]);
    expect(hints.has('map-b', { q: 1, r: 2 })).toBe(false);
    hints.set(null, [{ q: 1, r: 2 }]);
    expect(hints.has('map-a', { q: 1, r: 2 })).toBe(false);
    expect(hints.count).toBe(0);
  });

  it('forgets a tile once the next hints leave it out (met, or a new window)', () => {
    const hints = new WildHintTiles();
    hints.set('map-a', [{ q: 1, r: 2 }]);
    hints.set('map-a', []);
    expect(hints.has('map-a', { q: 1, r: 2 })).toBe(false);
  });
});

describe('tilesToMark', () => {
  const tiles = [
    { q: 1, r: 2 },
    { q: 0, r: 0 },
  ];

  it('marks every hinted tile on a patch', () => {
    expect(tilesToMark(tiles, false)).toEqual(tiles);
  });

  it('marks nothing on the Tutorial Glade: battles wait for their own step', () => {
    expect(tilesToMark(tiles, true)).toEqual([]);
  });
});
