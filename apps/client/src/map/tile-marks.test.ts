import { hexKey } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { TILE_MARK } from './map-config.js';
import { testView } from './test-view.js';
import { markSpot, pickMarks, type TileMark } from './tile-marks.js';

const [a, b] = testView().tiles;
const screen = { width: 390, height: 844 };

describe('pickMarks (#602)', () => {
  it('shows one mark a tile: the most pressing any source says', () => {
    const sources = new Map<string, readonly TileMark[]>([
      ['buildings', [{ tile: a!, kind: 'napping' }]],
      [
        'gatherers',
        [
          { tile: a!, kind: 'meh' },
          { tile: b!, kind: 'napping' },
        ],
      ],
    ]);
    const picked = pickMarks(sources);
    expect(picked.size).toBe(2);
    expect(picked.get(hexKey(a!))?.kind).toBe('meh');
    expect(picked.get(hexKey(b!))?.kind).toBe('napping');
  });

  it('lists its kinds most pressing first', () => {
    expect(TILE_MARK.kinds).toEqual(['meh', 'napping']);
    for (const kind of TILE_MARK.kinds) expect(TILE_MARK.glyphs[kind]).not.toBe('');
  });
});

describe('markSpot (#602)', () => {
  const rect = { x: 100, y: 200, width: 80, height: 60 };

  it('sits just beside what it is about (a gatherer’s head)', () => {
    const [right] = TILE_MARK.beside;
    expect(markSpot({ x: 150, y: 300 }, rect, screen)).toEqual({
      x: 150 + right.x,
      y: 300 + right.y,
    });
  });

  it('keeps clear of a flag: the other side of the head, then above it, else hidden', () => {
    const [right, left, above] = TILE_MARK.beside;
    const head = { x: 150, y: 300 };
    const chip = (d: { x: number; y: number }) => ({
      x: head.x + d.x - TILE_MARK.size / 2,
      y: head.y + d.y - TILE_MARK.size / 2,
      width: TILE_MARK.size,
      height: TILE_MARK.size,
    });
    expect(markSpot(head, null, screen, [chip(right)])).toEqual({
      x: head.x + left.x,
      y: head.y + left.y,
    });
    // A wide label over both sides of the head (a village's flag, #602's screens).
    expect(markSpot(head, null, screen, [chip(right), chip(left)])).toEqual({
      x: head.x + above.x,
      y: head.y + above.y,
    });
    expect(markSpot(head, null, screen, [chip(right), chip(left), chip(above)])).toBeNull();
  });

  it("sits in the tile's top right with nothing to sit by", () => {
    expect(markSpot(null, rect, screen)).toEqual({
      x: Math.round(100 + 80 * TILE_MARK.across),
      y: Math.round(200 + 60 * TILE_MARK.down),
    });
  });

  it('hides off screen instead of pinning to the edge (the old badges did)', () => {
    expect(markSpot({ x: -40, y: 300 }, null, screen)).toBeNull();
    expect(markSpot(null, { ...rect, x: 500 }, screen)).toBeNull();
    expect(markSpot(null, null, screen)).toBeNull();
  });
});
