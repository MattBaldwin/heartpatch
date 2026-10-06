/**
 * `pnpm sim:progression`: the day-by-day progression model. Runs both kinds
 * of kid on each map size under the shipped rules and the baseline, and
 * writes `progression-report.md` to `reports/sim/` (git-ignored), or to
 * `--out <dir>`. The same data and config always give the same report.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  BASELINE_RULES,
  CURRENT_RULES,
  NO_FALLOFF_RULES,
  PROGRESSION_CONFIG,
  UNCAPPED_BEFRIEND_RULES,
} from './progression-config.js';
import { renderProgression, summarise } from './progression-report.js';
import { modelData, runProgression, wildOdds, type ProgressionRun } from './progression.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const data = modelData();
const runs: ProgressionRun[] = [];
for (const rules of [BASELINE_RULES, CURRENT_RULES, NO_FALLOFF_RULES, UNCAPPED_BEFRIEND_RULES]) {
  for (const seats of PROGRESSION_CONFIG.seats) {
    for (const kid of PROGRESSION_CONFIG.kids) {
      runs.push(runProgression(data, PROGRESSION_CONFIG, rules, kid, seats));
    }
  }
}
const odds = wildOdds(data, PROGRESSION_CONFIG, [-2, -1, 0, 1], 200);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'progression-report.md');
writeFileSync(reportPath, renderProgression(runs, PROGRESSION_CONFIG, { seconds, odds }));

console.log(`${String(runs.length)} runs in ${seconds.toFixed(1)} s.`);
for (const s of runs.map((run) => summarise(run, PROGRESSION_CONFIG))) {
  console.log(
    `  ${s.rules.padEnd(20)} ${String(s.seats)} seats ${s.kid.padEnd(7)} evolves day ${String(s.evolves)}, ` +
      `Lv 20 day ${String(s.bigAndBouncy)}, Gap ready day ${String(s.gapReady)}, ` +
      `land full day ${String(s.landFull)}, Lv ${String(s.level[14])} / ${String(s.level[30])} on days 14 / 30`,
  );
}
console.log(`Report: ${reportPath}`);
