import { defineConfig } from 'vitest/config';

// Tests run against workspace package sources, like `pnpm dev` does.
const conditions = ['@heartpatch/source', 'node', 'import', 'module', 'default'];

export default defineConfig({
  resolve: { conditions },
  ssr: {
    resolve: {
      // Vitest also hands these to Node as `--conditions`. `import` and
      // `module` there would make CommonJS `require()` load a package's ESM
      // entry (it broke `ws` inside @fastify/websocket); Vite adds them itself.
      conditions: ['@heartpatch/source', 'node', 'default'],
      externalConditions: conditions,
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Creates and migrates a scratch database for DB integration tests.
    globalSetup: ['./tests/global-setup.ts'],
  },
});
