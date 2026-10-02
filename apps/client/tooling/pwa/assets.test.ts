import { describe, expect, it } from 'vitest';
import { pwaFiles, splashImages, webManifest } from './assets.js';

describe('PWA assets', () => {
  it('has a manifest whose icons are all served', () => {
    const manifest = JSON.parse(webManifest()) as {
      display: string;
      start_url: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    const paths = new Set(pwaFiles().map((file) => file.path));
    for (const icon of manifest.icons) expect(paths.has(icon.src)).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  });

  it('has one splash per size and orientation, never precached', () => {
    const splashes = splashImages();
    expect(new Set(splashes.map((s) => s.path)).size).toBe(splashes.length);
    expect(new Set(splashes.map((s) => s.media)).size).toBe(splashes.length);
    const files = new Map(pwaFiles().map((file) => [file.path, file]));
    for (const splash of splashes) expect(files.get(splash.path)?.precache).toBe(false);
  });
});
