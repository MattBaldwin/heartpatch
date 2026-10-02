import { describe, expect, it } from 'vitest';
import { BACKGROUND, renderIcon, renderSplash } from './art.js';
import type { Raster } from './png.js';

const at = ({ width, pixels }: Raster, x: number, y: number) => {
  const i = (y * width + x) * 3;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
};

describe('squishy art', () => {
  it('draws an opaque icon: theme colour at the edges, pink squishy in the middle', () => {
    const icon = renderIcon(128, 0.62);
    expect(icon.pixels.length).toBe(128 * 128 * 3);
    expect(at(icon, 0, 0)).toEqual([...BACKGROUND]);
    expect(at(icon, 127, 127)).toEqual([...BACKGROUND]);
    const [r, g] = at(icon, 64, 80);
    expect(r! - g!).toBeGreaterThan(80);
  });

  it('draws splash screens at the exact device size in both orientations', () => {
    const portrait = renderSplash(150, 300);
    const landscape = renderSplash(300, 150);
    expect([portrait.width, portrait.height]).toEqual([150, 300]);
    expect([landscape.width, landscape.height]).toEqual([300, 150]);
    expect(at(portrait, 0, 299)).toEqual([...BACKGROUND]);
    expect(at(landscape, 299, 0)).toEqual([...BACKGROUND]);
  });
});
