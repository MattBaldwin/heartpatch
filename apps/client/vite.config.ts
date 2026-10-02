/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

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
  plugins: [forbidServerData()],
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
    include: ['src/**/*.test.ts'],
  },
});
