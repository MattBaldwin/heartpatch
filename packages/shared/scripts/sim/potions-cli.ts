/**
 * `pnpm sim:potions`: the potion sim (#214). Writes `potions-report.md` to
 * `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { POTION_SIM_CONFIG, renderPotionReport, runPotionSim } from './potions.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const result = runPotionSim(POTION_SIM_CONFIG);
const seconds = (performance.now() - started) / 1000;
const battles = result.rows
  .filter((r) => r.partnerLevel === 'all')
  .reduce((sum, r) => sum + r.battles, 0);

mkdirSync(outDir, { recursive: true });
const path = resolve(outDir, 'potions-report.md');
const report = renderPotionReport(result, POTION_SIM_CONFIG);
writeFileSync(path, report);
console.log(report.split('## Partner level')[0]);
console.log(`${String(battles)} battles in ${seconds.toFixed(1)} s. Report: ${path}`);
