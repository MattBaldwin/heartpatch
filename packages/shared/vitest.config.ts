import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // `pnpm test:coverage`: issue #11 requires ≥ 90% on the engine and RNG.
    coverage: {
      include: ['src/battle/**', 'src/rng/**'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
