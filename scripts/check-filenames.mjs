// Fails if a tracked source file isn't kebab-case (e.g. `game-events.ts`,
// `create-scene.test.ts`). One convention across the repo; kebab-case also
// avoids case-only renames, which case-insensitive file systems (macOS) mishandle.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/;
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => SOURCE.test(file));

const bad = files.filter(
  (file) =>
    !basename(file)
      .split('.')
      .slice(0, -1)
      .every((s) => SEGMENT.test(s)),
);

if (bad.length > 0) {
  console.error('Source file names must be kebab-case (CLAUDE.md, Conventions):');
  for (const file of bad) console.error(`  ${file}`);
  process.exit(1);
}
