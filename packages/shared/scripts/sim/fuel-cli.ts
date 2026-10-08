/**
 * `pnpm sim:fuel` (#202): how many Hearthfires a casual and an engaged kid
 * can keep lit. Runs the progression model under the shipped rules for the
 * land, then the fuel model for each shown day, and writes `fuel-report.md`
 * to `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FUEL_CONFIG } from './fuel-config.js';
import { renderFuel, runFuel } from './fuel-report.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const rows = runFuel(FUEL_CONFIG, PROGRESSION_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'fuel-report.md');
writeFileSync(reportPath, renderFuel(rows, FUEL_CONFIG, { seconds }));

console.log(`${String(rows.length)} runs in ${seconds.toFixed(1)} s.`);
for (const row of rows) {
  const days = row.days
    .map(
      (d) =>
        `day ${String(d.day)}: ${String(d.lit)} lit (land ${String(d.landFires)}, fuel ${String(d.fuelFires)}, Keeper alone ${String(d.keeperFires)}); all land needs ${String(d.cover.fires)} (${d.cover.fuelOk && d.cover.costOk ? 'ok' : d.cover.fuelOk ? 'short on build' : 'short on fuel'})`,
    )
    .join('; ');
  console.log(`  ${String(row.seats)} seats ${row.kid.padEnd(7)} ${days}`);
}
console.log(`Report: ${reportPath}`);
