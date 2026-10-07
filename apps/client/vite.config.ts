/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { changelogAsset } from './tooling/changelog/plugin.js';
import { readBuildInfo, runGit } from './tooling/version/build-info.js';
import { pwaAssets } from './tooling/pwa/plugin.js';

/**
 * Fails the dev server and build if any server-only data module is loaded,
 * including through re-exports lint can't see (tech spec §2, CLAUDE.md rule 6).
 */
function forbidServerData(): Plugin {
  return {
    name: 'heartpatch:forbid-server-data',
    enforce: 'pre',
    load(id) {
      if (/[\\/]data[\\/]server[\\/]/.test(id)) {
        this.error(`Server-only data must never reach the client bundle: ${id}`);
      }
      return null;
    },
  };
}

export default defineConfig({
  // The version line in the profile menu (#198): src/pwa/build-info.ts.
  define: {
    __HP_BUILD__: JSON.stringify(readBuildInfo({ env: process.env, git: runGit, now: new Date() })),
  },
  plugins: [
    forbidServerData(),
    pwaAssets(),
    // What's new (#220): changelog.json from changes/*.md.
    changelogAsset(),
    // The service worker (issue #26, tech spec §3): src/pwa/sw.ts, built to
    // /sw.js with the build's precache list. Production builds only.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      injectRegister: false, // src/pwa/register.ts registers it
      manifest: false, // tooling/pwa serves manifest.webmanifest
      injectManifest: {
        rollupFormat: 'iife',
        // The offline shell: the page, its bundles and styles, the manifest
        // and icons. Not source maps, splash screens or dev pages.
        globPatterns: [
          'index.html',
          'assets/**/*.{js,css}',
          'manifest.webmanifest',
          // What's new (#220): opens offline too.
          'changelog.json',
          'favicon.svg',
          'pwa/icon-*.png',
          'pwa/apple-touch-icon.png',
        ],
        // Hashed names already change with their content.
        dontCacheBustURLsMatching: /^assets\//,
        // TUNE: the engine bundle is ~1 MB; fail the build well before a
        // bundle could silently drop out of the shell.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    // Use workspace package sources directly (see packages/shared/package.json).
    conditions: ['@heartpatch/source', ...defaultClientConditions],
  },
  // Vitest runs tests as SSR, so its resolver needs the workspace condition too.
  // Not Vite's `defaultServerConditions`: Vitest also passes these to Node as
  // `--conditions`, where `module` can make `require()` load ESM entries.
  // Only tests use this; `vite build` targets the browser.
  ssr: { resolve: { conditions: ['@heartpatch/source', 'node'] } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
      // Live sync (tech spec §5). The Origin header passes through unchanged.
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts', 'tooling/**/*.test.ts'],
  },
});
