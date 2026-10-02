/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Use workspace package sources directly (see packages/shared/package.json).
    conditions: ['@heartpatch/source', ...defaultClientConditions],
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
