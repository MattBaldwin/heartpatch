// Fails if the determinism lint rule for procedural squishy code stops firing
// (eslint.config.js, "Procedural squishies/Keepers"). Every squishy must look
// the same for every player, so variation only comes from the seeded Rng:
// Math.random and crypto randomness are banned in apps/client/src/procedural.
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function fires(code, file) {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return (result?.messages ?? []).some((m) => m.ruleId === 'no-restricted-properties');
}

const banned = [
  'Math.random()',
  'crypto.getRandomValues(new Uint8Array(4))',
  'crypto.randomUUID()',
];
const problems = [];
for (const call of banned) {
  if (!(await fires(`export const roll = ${call};\n`, 'apps/client/src/procedural/params.ts'))) {
    problems.push(`${call} is no longer banned in apps/client/src/procedural`);
  }
}
// The rule is scoped: the rest of the client may use Math.random (e.g. reconnect jitter).
if (await fires('export const roll = Math.random();\n', 'apps/client/src/main.ts')) {
  problems.push('the procedural rule now also applies outside apps/client/src/procedural');
}

if (problems.length > 0) {
  console.error('Procedural determinism lint rule (eslint.config.js):');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
