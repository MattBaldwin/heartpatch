// Fails if the client build (apps/client/dist, source maps included) mentions
// server-only data (tech spec §2, CLAUDE.md rule 6). Vite's forbidServerData
// stops server data modules loading at all; this also catches their names,
// error strings and schemas riding in through the public entry, e.g. a check's
// message naming SECRET_SPECIES. Runs after `pnpm build` (root package.json),
// since it needs both builds.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'apps/client/dist');
const serverEntry = join(root, 'packages/shared/dist/data/server/index.js');

for (const [what, path] of [
  ['client build', dist],
  ['shared build', serverEntry],
]) {
  if (!statSync(path, { throwIfNoEntry: false })) {
    console.error(`check-client-bundle: no ${what} at ${relative(root, path)}; run pnpm build.`);
    process.exit(1);
  }
}

/** Everything `@heartpatch/shared/server` exports: secret tables and the code that reads them. */
const serverExports = Object.keys(await import(serverEntry));
/** Server-only, though the public entry exports them (tree-shaking keeps them out). */
const publicEntryServerOnly = [
  'checkClothingDrops',
  'ClothingDropTableSchema',
  'ClothingDropEntrySchema',
];
const bannedWords = [...serverExports, ...publicEntryServerOnly];
const bannedText = ['SECRET_', 'placeholder-'];
/** Source files of server-only data, as source maps list them. */
const bannedSources = [
  /[\\/]data[\\/]server[\\/]/,
  /[\\/]schemas[\\/]data[\\/](clothing-drops|guardian-rules|server-game-data|spawn-rules|spawn-tables)\.ts$/,
];

const wordPattern = new RegExp(`\\b(${bannedWords.join('|')})\\b`, 'g');
const textFile = /\.(js|mjs|map|html|css|json|webmanifest|txt)$/;

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (textFile.test(entry.name)) yield path;
  }
}

const problems = [];
for (const file of files(dist)) {
  const text = readFileSync(file, 'utf8');
  const name = relative(root, file);
  const found = new Set(text.match(wordPattern) ?? []);
  for (const banned of bannedText) if (text.includes(banned)) found.add(banned);
  if (found.size > 0) problems.push(`${name}: ${[...found].sort().join(', ')}`);
  if (file.endsWith('.map')) {
    const { sources = [] } = JSON.parse(text);
    for (const source of sources) {
      if (bannedSources.some((pattern) => pattern.test(source))) {
        problems.push(`${name}: bundles ${source}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('Server-only data in the client build (tech spec §2, CLAUDE.md rule 6):');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    'Keep server-only checks and schemas out of what the client imports from @heartpatch/shared.',
  );
  process.exit(1);
}
console.log(`check-client-bundle: no server-only data in ${relative(root, dist)}`);
