/**
 * `pnpm sim:clockwork` (#874 Wave 1, lane C6): power, Parts, research and
 * Blueprints for a casual and an engaged kid on a Clockwork Isle, and
 * writes `clockwork-report.md` to `reports/sim/`, or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CLOCKWORK_CONFIG } from './clockwork-config.js';
import { clockworkGuards, renderClockwork, runClockwork, runFacts } from './clockwork.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const runs = runClockwork(CLOCKWORK_CONFIG, PROGRESSION_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'clockwork-report.md');
writeFileSync(reportPath, renderClockwork(runs, CLOCKWORK_CONFIG, { seconds }));

console.log(`${String(runs.length)} runs in ${seconds.toFixed(1)} s → ${reportPath}`);
for (const run of runs) {
  const f = runFacts(run);
  console.log(
    `  ${run.kid.padEnd(7)} ${run.ruling ? 'ruling' : 'data  '} Windmill day ${String(f.windmillDay ?? '-')}, Sorter day ${String(f.sorterDay ?? '-')}, Beacon day ${String(f.beaconDay ?? '-')}, Blueprints ${String(run.blueprintsGranted)}/${String(run.blueprintsSpent)}${run.stuck ? `, stuck on ${run.stuck.step}` : ''}`,
  );
}
for (const g of clockworkGuards(runs, CLOCKWORK_CONFIG)) {
  console.log(`  ${g.pass ? 'ok  ' : 'FAIL'} ${g.name}: ${g.value}`);
}
