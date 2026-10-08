/**
 * `pnpm sim:factory` (#294): the first day a casual and an engaged kid can
 * pay for each Crafting Factory level, and writes `factory-report.md` to
 * `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FACTORY_CONFIG } from './factory-config.js';
import { renderFactory, runFactory } from './factory.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const rows = runFactory(FACTORY_CONFIG, PROGRESSION_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'factory-report.md');
writeFileSync(reportPath, renderFactory(rows, FACTORY_CONFIG, { seconds }));

console.log(`${String(rows.length)} runs in ${seconds.toFixed(1)} s.`);
for (const row of rows) {
  const days = row.levelDays
    .map((d, i) => `level ${String(i + 1)} day ${d === null ? '-' : String(d)}`)
    .join(', ');
  console.log(`  ${String(row.seats)} seats ${row.kid.padEnd(7)} ${days}`);
}
console.log(`Report: ${reportPath}`);
