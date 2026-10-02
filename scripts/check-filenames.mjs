// Fails if a tracked source file, or any folder it lives in, isn't kebab-case
// (e.g. `src/db/game-events.ts`, `create-scene.test.ts`). One convention across
// the repo; kebab-case also avoids case-only renames, which case-insensitive
// file systems (macOS) mishandle.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Each dot-separated part of a name; a leading dot (dotfile/dotfolder) is allowed. */
const isKebab = (name) =>
  name
    .replace(/^\./, '')
    .split('.')
    .every((part) => SEGMENT.test(part));

let files;
try {
  // Always list from the repo root, wherever this script is run from.
  const root = fileURLToPath(new URL('..', import.meta.url));
  files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
} catch {
  console.error('check-filenames: needs a git checkout (could not run `git ls-files`).');
  process.exit(1);
}

const bad = files
  .filter((file) => SOURCE.test(file))
  .filter((file) => {
    const folders = file.split('/');
    const name = folders.pop() ?? '';
    const base = name.slice(0, name.lastIndexOf('.'));
    return !isKebab(base) || !folders.every(isKebab);
  });

if (bad.length > 0) {
  console.error('Source file and folder names must be kebab-case (CLAUDE.md, Conventions):');
  for (const file of bad) console.error(`  ${file}`);
  process.exit(1);
}
