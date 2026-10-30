import { describe, expect, it } from 'vitest';
import { wholeRowHeight } from './panel-fit.js';

// Rows 40px tall with 8px between them, from 12px down (the panel's padding).
const rows = Array.from({ length: 8 }, (_, i) => ({ top: 12 + i * 48, bottom: 52 + i * 48 }));

describe('wholeRowHeight', () => {
  it('keeps a cap that already ends between rows', () => {
    expect(wholeRowHeight(150, rows)).toBe(150); // 148 is a bottom, 156 the next top
  });

  it('stops at the top of the row the cap would cut', () => {
    expect(wholeRowHeight(280, rows)).toBe(252);
  });

  it('cuts above a pair whose taller half crosses the cap', () => {
    const pair = [...rows.slice(0, 2), { top: 108, bottom: 148 }, { top: 108, bottom: 170 }];
    expect(wholeRowHeight(160, pair)).toBe(108);
  });

  it('keeps the cap when only one tall row would be left (it scrolls)', () => {
    expect(
      wholeRowHeight(300, [
        { top: 12, bottom: 40 },
        { top: 48, bottom: 600 },
      ]),
    ).toBe(300);
  });

  it('a phone on its side: the shorter cap under the name pill still ends between rows', () => {
    // 393px tall: 100dvh - 128px (map.css) is 265, which cuts the sixth row.
    const cap = 393 - 128;
    const height = wholeRowHeight(cap, rows);
    expect(height).toBe(252);
    expect(rows.some((r) => r.top < height && r.bottom > height)).toBe(false);
  });

  it('ignores subpixel brushes with a row edge', () => {
    expect(wholeRowHeight(52.5, rows)).toBe(52.5);
  });
});
