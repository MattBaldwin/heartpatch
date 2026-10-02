import { defineConfig } from 'vitest/config';

// Tests run against workspace package sources, like `pnpm dev` does.
const conditions = ['@heartpatch/source', 'node', 'import', 'module', 'default'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Creates and migrates a scratch database for DB integration tests.
    globalSetup: ['./tests/global-setup.ts'],
  },
});
