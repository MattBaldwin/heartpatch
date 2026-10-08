/**
 * `pnpm sim:costumes` (#261): how long a busy and a casual kid take to find
 * or buy each tier of Halloween costume before the window closes. Writes
 * `costumes-report.md` to `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { COSTUME_CONFIG } from './costumes-config.js';
import { costumeTableLines, renderCostumes, runCostumes } from './costumes.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const rows = runCostumes(COSTUME_CONFIG);
mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'costumes-report.md');
writeFileSync(reportPath, renderCostumes(rows, COSTUME_CONFIG));
for (const row of rows) {
  console.log(row.profile);
  for (const line of costumeTableLines(row, COSTUME_CONFIG.windowDays)) console.log(`  ${line}`);
}
console.log(`Report: ${reportPath}`);
