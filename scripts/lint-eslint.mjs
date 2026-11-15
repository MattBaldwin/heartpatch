// Runs ESLint one workspace package at a time, then the root files.
//
// `eslint .` over the whole monorepo builds one type-aware program for every
// package at once (`projectService`), and by #809 that run no longer fit in a
// 6 GB V8 heap on CI ("Ineffective mark-compacts near heap limit"). Linting
// each package in its own process keeps every shard well under 3 GB and the
// rules, config and results exactly the same; only the peak memory changes.
import { spawnSync } from 'node:child_process';

const HEAP = '--max-old-space-size=6144';
const SHARDS = [
  ['packages/shared'],
  ['apps/server'],
  ['apps/client'],
  // Root files only (eslint.config.js, scripts/): the packages are done above.
  ['.', '--ignore-pattern', 'packages/**', '--ignore-pattern', 'apps/**'],
];

for (const shard of SHARDS) {
  const started = Date.now();
  const result = spawnSync('pnpm', ['exec', 'eslint', ...shard, '--max-warnings', '0'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: HEAP },
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (result.status !== 0) {
    console.error(`eslint failed on ${shard[0]} after ${seconds}s`);
    process.exit(result.status ?? 1);
  }
  console.log(`eslint ok: ${shard[0]} (${seconds}s)`);
}
