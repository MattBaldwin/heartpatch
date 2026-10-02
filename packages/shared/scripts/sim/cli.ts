/**
 * `pnpm sim`: the balance simulator (issue #12). Plays seeded AI-vs-AI
 * battles with the real engine and writes `balance-report.md` and
 * `balance-report.csv` to `reports/sim/` (git-ignored), or to `--out <dir>`.
 * The same data and config always give the same report.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SIM_CONFIG } from './config.js';
import { planSim } from './matchups.js';
import { buildRows, describe, flaggedRows, renderCsv, renderMarkdown } from './report.js';
import { runSim } from './run.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const plan = planSim(SIM_CONFIG);
const results = runSim(plan, SIM_CONFIG);
const seconds = (performance.now() - started) / 1000;

const battles = results.reduce((sum, r) => sum + r.aWins + r.bWins + r.draws, 0);
const turns = results.reduce((sum, r) => sum + r.turns, 0);
const rows = buildRows(results, SIM_CONFIG);
const info = {
  contentHash: plan.content.contentHash,
  battles,
  averageTurns: battles === 0 ? 0 : turns / battles,
  seconds,
};

mkdirSync(outDir, { recursive: true });
const markdownPath = resolve(outDir, 'balance-report.md');
const csvPath = resolve(outDir, 'balance-report.csv');
writeFileSync(markdownPath, renderMarkdown(rows, SIM_CONFIG, info));
writeFileSync(csvPath, renderCsv(rows));

const flags = flaggedRows(rows);
console.log(`${battles} battles in ${seconds.toFixed(1)} s; ${flags.length} flagged.`);
for (const r of flags.slice(0, 15)) {
  console.log(`  ${(r.winRate * 100).toFixed(1).padStart(5)}%  ${describe(r)}  → ${r.tune}`);
}
console.log(`Report: ${markdownPath}\nCSV:    ${csvPath}`);
