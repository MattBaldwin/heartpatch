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
  NO_TRAINING_RULES,
  PROGRESSION_CONFIG,
  UNCAPPED_BEFRIEND_RULES,
  WITH_EXPLORE_RULES,
} from './progression-config.js';
import { JOURNEY_RULES } from '../../src/data/journeys.js';
import { journeyGateMisses, renderProgression, summarise } from './progression-report.js';
import {
  journeyOdds,
  modelData,
  runProgression,
  wildOdds,
  type ProgressionRun,
} from './progression.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const data = modelData();
const runs: ProgressionRun[] = [];
for (const rules of [
  BASELINE_RULES,
  NO_TRAINING_RULES,
  CURRENT_RULES,
  WITH_EXPLORE_RULES,
  NO_FALLOFF_RULES,
  UNCAPPED_BEFRIEND_RULES,
]) {
  for (const seats of PROGRESSION_CONFIG.seats) {
    for (const kid of PROGRESSION_CONFIG.kids) {
      runs.push(runProgression(data, PROGRESSION_CONFIG, rules, kid, seats));
    }
  }
}
const odds = wildOdds(data, PROGRESSION_CONFIG, [-2, -1, 0, 1], 200);
// Journeys (#270): the shipped rules on the 4-seat map, both kids.
const journeyRuns = runs.filter((r) => r.rules === CURRENT_RULES && r.seats === 4);
const journeys = journeyOdds(data, PROGRESSION_CONFIG, journeyRuns, JOURNEY_RULES, {
  days: [3, 7, 14],
  distances: [1, 2, 3, 4, 5, 6, 7, 8, 10],
  games: 200,
});
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'progression-report.md');
writeFileSync(reportPath, renderProgression(runs, PROGRESSION_CONFIG, { seconds, odds, journeys }));

console.log(`${String(runs.length)} runs in ${seconds.toFixed(1)} s.`);
for (const s of runs.map((run) => summarise(run, PROGRESSION_CONFIG))) {
  console.log(
    `  ${s.rules.padEnd(20)} ${String(s.seats)} seats ${s.kid.padEnd(7)} evolves day ${String(s.evolves)}, ` +
      `Lv 20 day ${String(s.bigAndBouncy)}, Gap ready day ${String(s.gapReady)}, ` +
      `land full day ${String(s.landFull)}, Lv ${String(s.level[14])} / ${String(s.level[30])} on days 14 / 30`,
  );
}
for (const row of journeys) {
  console.log(
    `  journeys ${row.kid.padEnd(7)} day ${String(row.day).padStart(2)} (${row.levels.join('/')}): ` +
      row.odds.map((o) => `d${String(o.distance)} ${String(o.percent)}%`).join(' '),
  );
}
const misses = journeyGateMisses(journeys);
console.log(
  misses.length === 0 ? '  journey gate: passes' : `  journey gate MISSES: ${misses.join('; ')}`,
);
console.log(`Report: ${reportPath}`);
