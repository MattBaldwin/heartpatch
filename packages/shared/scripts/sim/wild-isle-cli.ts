/**
 * `pnpm sim:wild-isle` (#621 W1-8): water works, weather and Heart Coins for
 * a casual and an engaged kid on a Wild Isle, and writes
 * `wild-isle-report.md` to `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PROGRESSION_CONFIG } from './progression-config.js';
import { WILD_ISLE_CONFIG } from './wild-isle-config.js';
import {
  renderWildIsle,
  runWildIsle,
  stormCostPercent,
  stormPair,
  worksUpkeepPercent,
} from './wild-isle.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const runs = runWildIsle(WILD_ISLE_CONFIG, PROGRESSION_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'wild-isle-report.md');
writeFileSync(reportPath, renderWildIsle(runs, WILD_ISLE_CONFIG, { seconds }));

console.log(`${String(runs.length)} runs in ${seconds.toFixed(1)} s.`);
for (const run of runs.filter((r) => r.storms)) {
  const { stormy, calm } = stormPair(runs, run.kid, run.away.length > 0);
  console.log(
    `  ${run.kid.padEnd(7)}${run.away.length > 0 ? ` away ${String(run.away[0])}` : '       '} pier day ${String(run.builtDay['fishing-pier'] ?? '-')}, River Well day ${String(run.builtDay['river-well'] ?? '-')}, upkeep ${String(worksUpkeepPercent(run))} % of output, storms ${String(stormCostPercent(stormy, calm))} %, ${String(run.days.at(-1)?.balance ?? 0)} 💛 on day ${String(run.days.at(-1)?.day ?? 0)}`,
  );
}
console.log(`Report: ${reportPath}`);
