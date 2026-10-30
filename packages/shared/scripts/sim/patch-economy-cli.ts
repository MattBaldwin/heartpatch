/**
 * `pnpm sim:patch-economy` (#601): resource buildings, the Warehouse and
 * Heart Coins for a casual and an engaged kid, and writes
 * `patch-economy-report.md` to `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PATCH_ECONOMY_CONFIG } from './patch-economy-config.js';
import {
  formatWhatPays,
  renderPatchEconomy,
  runPatchEconomy,
  upkeepPercent,
  whatPays,
} from './patch-economy.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const runs = runPatchEconomy(PATCH_ECONOMY_CONFIG, PROGRESSION_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'patch-economy-report.md');
writeFileSync(reportPath, renderPatchEconomy(runs, PATCH_ECONOMY_CONFIG, { seconds }));

console.log(`${String(runs.length)} runs in ${seconds.toFixed(1)} s.`);
for (const run of runs) {
  const last = run.days.at(-1);
  console.log(
    `  ${String(run.seats)} seats ${run.kid.padEnd(7)}${run.away.length > 0 ? ` away ${String(run.away[0])}` : '       '}${run.warehouse ? '' : ' no-wh'} first hut day ${String(run.firstHutDay ?? '-')}, upkeep ${String(upkeepPercent(run, run.allHutsDay ?? 999))} % of 💛, ${String(last?.balance ?? 0)} 💛 on day ${String(last?.day ?? 0)}`,
  );
}
const paysRun = runs.find(
  (r) =>
    r.kid === PATCH_ECONOMY_CONFIG.whatPays.kid &&
    r.seats === PATCH_ECONOMY_CONFIG.seats[0] &&
    r.away.length === 0 &&
    r.warehouse,
);
if (paysRun) {
  // TODO(#729): exit non-zero on a FAIL once #729 merges; soft until then.
  console.log(
    `  ${formatWhatPays(whatPays(paysRun, PATCH_ECONOMY_CONFIG), paysRun, PATCH_ECONOMY_CONFIG)}`,
  );
}
console.log(`Report: ${reportPath}`);
