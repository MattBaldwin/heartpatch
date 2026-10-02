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
  // Vitest runs unit tests through the SSR resolver; give it the same source condition.
  ssr: {
    resolve: {
      conditions: ['@heartpatch/source', 'node', 'import', 'module', 'default'],
      externalConditions: ['@heartpatch/source', 'node', 'import', 'module', 'default'],
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
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
