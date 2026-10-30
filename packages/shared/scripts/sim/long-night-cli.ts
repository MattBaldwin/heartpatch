/**
 * `pnpm sim:long-night` (#727): how often a casual and an engaged kid, alone
 * and in a 4-seat patch, hold the Long Night in month one, stocked,
 * unstocked and as they play. Writes `long-night-report.md` to
 * `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LONG_NIGHT_CONFIG } from './long-night-config.js';
import { longNightGates, renderLongNight, runLongNight } from './long-night.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const rows = runLongNight(LONG_NIGHT_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'long-night-report.md');
writeFileSync(reportPath, renderLongNight(rows, LONG_NIGHT_CONFIG, { seconds }));

console.log(`${String(rows.length)} rows in ${seconds.toFixed(1)} s.`);
for (const r of rows) {
  console.log(
    `  ${r.kid.padEnd(7)} ${String(r.seats)} seats ${r.readiness.padEnd(12)} Keeper held ${(r.keeperHolds * 100).toFixed(1)} %, patch held ${(r.patchHolds * 100).toFixed(1)} %`,
  );
}
for (const g of longNightGates(rows, LONG_NIGHT_CONFIG)) {
  console.log(`${g.pass ? 'PASS' : 'FAIL'}: ${g.label} (${(g.value * 100).toFixed(1)} %)`);
}
console.log(`Report: ${reportPath}`);
