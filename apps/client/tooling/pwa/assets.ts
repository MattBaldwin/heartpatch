import { renderIcon, renderSplash } from './art.js';
import { encodePng } from './png.js';

// Everything the installed app needs besides the game itself: the web app
// manifest, icons and iOS launch screens. One table, used by the dev server
// and the build, so the manifest, the <link> tags and the files can't drift.

export const APP_NAME = 'Heartpatch';
export const THEME_COLOR = '#fde8f0';
export const MANIFEST_PATH = '/manifest.webmanifest';
export const APPLE_TOUCH_ICON_PATH = '/pwa/apple-touch-icon.png';

/** The manifest's icons plus the iOS home-screen icon. `fill`: heart width / icon width. */
const ICONS = [
  { path: '/pwa/icon-192.png', size: 192, fill: 0.62, purpose: 'any' },
  { path: '/pwa/icon-512.png', size: 512, fill: 0.62, purpose: 'any' },
  // Maskable icons may be cropped to a circle of 80% of the width.
  { path: '/pwa/icon-maskable-512.png', size: 512, fill: 0.5, purpose: 'maskable' },
] as const;
// iOS rounds the corners itself and wants an opaque 180×180 PNG.
const APPLE_TOUCH_ICON = { path: APPLE_TOUCH_ICON_PATH, size: 180, fill: 0.62 } as const;

/**
 * iOS needs one launch image per screen size and orientation, picked by media
 * query; it shows a blank screen for any size missing here. Points (CSS px)
 * and device pixel ratio, portrait. Current and recent iPhones and iPads.
 */
export const SPLASH_SCREENS: readonly { width: number; height: number; ratio: number }[] = [
  { width: 375, height: 667, ratio: 2 }, // iPhone SE (2nd, 3rd gen), 8
  { width: 375, height: 812, ratio: 3 }, // iPhone 12 mini, 13 mini, X, XS, 11 Pro
  { width: 390, height: 844, ratio: 3 }, // iPhone 12, 13, 14, 16e
  { width: 393, height: 852, ratio: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { width: 402, height: 874, ratio: 3 }, // iPhone 16 Pro, 17, 17 Pro
  { width: 414, height: 896, ratio: 2 }, // iPhone 11, XR
  { width: 414, height: 896, ratio: 3 }, // iPhone 11 Pro Max, XS Max
  { width: 420, height: 912, ratio: 3 }, // iPhone Air
  { width: 428, height: 926, ratio: 3 }, // iPhone 12/13 Pro Max, 14 Plus
  { width: 430, height: 932, ratio: 3 }, // iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 440, height: 956, ratio: 3 }, // iPhone 16 Pro Max, 17 Pro Max
  { width: 744, height: 1133, ratio: 2 }, // iPad mini (6th, 7th gen)
  { width: 810, height: 1080, ratio: 2 }, // iPad 10.2" (7th–9th gen)
  { width: 820, height: 1180, ratio: 2 }, // iPad (10th, 11th gen), iPad Air 10.9"/11"
  { width: 834, height: 1112, ratio: 2 }, // iPad Air (3rd gen), iPad Pro 10.5"
  { width: 834, height: 1194, ratio: 2 }, // iPad Pro 11" (1st–4th gen)
  { width: 834, height: 1210, ratio: 2 }, // iPad Pro 11" (M4, M5)
  { width: 1024, height: 1366, ratio: 2 }, // iPad Pro 12.9", iPad Air 13"
  { width: 1032, height: 1376, ratio: 2 }, // iPad Pro 13" (M4, M5)
];

export interface SplashImage {
  path: string;
  /** Image size in device pixels. */
  width: number;
  height: number;
  media: string;
}

export function splashImages(): SplashImage[] {
  return SPLASH_SCREENS.flatMap(({ width, height, ratio }) =>
    (['portrait', 'landscape'] as const).map((orientation) => {
      const w = (orientation === 'portrait' ? width : height) * ratio;
      const h = (orientation === 'portrait' ? height : width) * ratio;
      return {
        path: `/pwa/splash-${String(w)}x${String(h)}.png`,
        width: w,
        height: h,
        media:
          `(device-width: ${String(width)}px) and (device-height: ${String(height)}px) and ` +
          `(-webkit-device-pixel-ratio: ${String(ratio)}) and (orientation: ${orientation})`,
      };
    }),
  );
}

export function webManifest(): string {
  const manifest = {
    id: '/',
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Collect, cuddle and look after the cutest squishies with your family.',
    start_url: '/',
    scope: '/',
    // iOS has no `fullscreen`; standalone hides all of Safari's bars.
    display: 'standalone',
    orientation: 'any',
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    categories: ['games', 'kids'],
    icons: ICONS.map(({ path, size, purpose }) => ({
      src: path,
      sizes: `${String(size)}x${String(size)}`,
      type: 'image/png',
      purpose,
    })),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * A file the plugin serves in dev and writes into the build. The precache
 * globs in vite.config.ts pick the manifest and icons but not the splash
 * screens: iOS reads those once, at install.
 */
export interface PwaFile {
  path: string;
  contentType: string;
  render: () => Buffer;
}

export function pwaFiles(): PwaFile[] {
  const icon = ({ path, size, fill }: { path: string; size: number; fill: number }): PwaFile => ({
    path,
    contentType: 'image/png',
    render: () => encodePng(renderIcon(size, fill)),
  });
  return [
    {
      path: MANIFEST_PATH,
      contentType: 'application/manifest+json',
      render: () => Buffer.from(webManifest()),
    },
    ...ICONS.map(icon),
    icon(APPLE_TOUCH_ICON),
    ...splashImages().map(({ path, width, height }): PwaFile => ({
      path,
      contentType: 'image/png',
      render: () => encodePng(renderSplash(width, height)),
    })),
  ];
}

/** `<link rel="apple-touch-startup-image">` tags for index.html (Vite escapes the attributes). */
export function splashLinks(): { tag: 'link'; attrs: Record<string, string> }[] {
  return splashImages().map(({ path, media }) => ({
    tag: 'link',
    attrs: { rel: 'apple-touch-startup-image', media, href: path },
  }));
}
