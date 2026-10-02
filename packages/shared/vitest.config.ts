import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    // `pnpm test:coverage` (run in CI): deterministic game logic stays ≥ 90% covered.
    coverage: {
      include: [
        'src/battle/**',
        'src/rng/**',
        'src/hex/**',
        'src/mapgen/**',
        'src/data/season-windows.ts',
      ],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
