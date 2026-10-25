/* global process, console, URL */
// Rewrites the `visual` block of the named species in species-wave-2.ts from a design file.
// Usage: node apply-visuals.mjs <design.mjs>  (the file's default export maps species id to a visual object),
// then run prettier on species-wave-2.ts. Dev tooling for the species sheet (#382).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FILE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../../packages/shared/src/data/species-wave-2.ts',
);
const design = (await import(pathToFileURL(path.resolve(process.argv[2])).href)).default;
let s = readFileSync(FILE, 'utf8');
for (const [id, v] of Object.entries(design)) {
  const i = s.indexOf(`    id: '${id}',`);
  if (i < 0) throw new Error(`no species ${id}`);
  const a = s.indexOf('    visual: {', i);
  const b = s.indexOf('\n    habitatPreferences', a);
  if (a < 0 || b < 0) throw new Error(`no visual block for ${id}`);
  s = `${s.slice(0, a)}    visual: ${JSON.stringify(v)},${s.slice(b)}`;
}
writeFileSync(FILE, s);
console.log('rewrote', Object.keys(design).length, 'visuals');
