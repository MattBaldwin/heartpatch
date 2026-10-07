import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { changelogJson, readChangelog } from './changelog.js';

// `pnpm --filter @heartpatch/client changelog` (#220): writes
// public/changelog.json with build numbers from git, for builds whose
// context has no .git (the deploy's Docker images). Fails on a bad entry.

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const out = fileURLToPath(new URL('../../public/changelog.json', import.meta.url));
const entries = readChangelog(`${repo}changes`, repo);
writeFileSync(out, changelogJson(entries));
const missing = entries.filter((e) => e.build === null).length;
console.log(
  `changelog: ${String(entries.length)} entries -> public/changelog.json` +
    (missing > 0 ? ` (${String(missing)} without a build: no git history?)` : ''),
);
