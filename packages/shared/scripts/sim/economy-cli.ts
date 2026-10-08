/**
 * `pnpm sim:economy` (#199): what homesteads add to a casual and an engaged
 * kid's gathering. Runs the progression model under the shipped rules for
 * the land, explores it day by day, then gathers a day with and without the
 * homestead bonus, and writes `economy-report.md` to `reports/sim/`
 * (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ECONOMY_CONFIG } from './economy-config.js';
import { gainPercent, renderEconomy, runCandidates, runEconomy } from './economy-report.js';
import { total } from './economy.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const rows = runEconomy(ECONOMY_CONFIG, PROGRESSION_CONFIG);
const candidates = runCandidates(ECONOMY_CONFIG, PROGRESSION_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'economy-report.md');
writeFileSync(reportPath, renderEconomy(rows, ECONOMY_CONFIG, { seconds }, candidates));

console.log(`${String(rows.length)} runs in ${seconds.toFixed(1)} s.`);
for (const row of rows) {
  const days = row.days
    .map(
      (d) =>
        `day ${String(d.day)}: ${String(d.homesteads)} homesteads, ${String(total(d.without))} → ${String(total(d.with))} (+${String(gainPercent(d))} %)`,
    )
    .join('; ');
  console.log(`  ${String(row.seats)} seats ${row.kid.padEnd(7)} ${days}`);
}
for (const c of candidates) {
  const gains = [...c.gains].map(([k, g]) => `${k} +${String(g)} %`).join(', ');
  console.log(`  candidate ${c.label}: ${gains}`);
}
console.log(`Report: ${reportPath}`);
