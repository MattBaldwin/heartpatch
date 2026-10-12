/**
 * `pnpm sim:potions`: the potion sim (#214). `--compare` adds the pre-#403
 * whole-turn sip beside each potion. Writes `potions-report.md` to
 * `reports/sim/` (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  POTION_SIM_CONFIG,
  renderPotionReport,
  runPotionSim,
  withWholeTurnPlans,
  type PotionSimConfig,
} from './potions.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: resolve(repoRoot, 'reports/sim') },
    // Wild levels around the Partner's, e.g. `--offset=-2..0` (default: SPAWN_RULES).
    offset: { type: 'string' },
    // Adds each potion under the pre-#403 rule (the sip is the whole turn) beside it.
    compare: { type: 'boolean', default: false },
  },
});
const offset = /^(-?\d+)\.\.(-?\d+)$/.exec(values.offset ?? '');
const config: PotionSimConfig = {
  ...POTION_SIM_CONFIG,
  ...(offset && { levelOffset: { min: Number(offset[1]), max: Number(offset[2]) } }),
  ...(values.compare && { plans: withWholeTurnPlans(POTION_SIM_CONFIG.plans) }),
};
const outDir = resolve(values.out);

const started = performance.now();
const result = runPotionSim(config);
const seconds = (performance.now() - started) / 1000;
const battles = result.rows
  .filter((r) => r.partnerLevel === 'all')
  .reduce((sum, r) => sum + r.battles, 0);

mkdirSync(outDir, { recursive: true });
const path = resolve(outDir, 'potions-report.md');
const report = renderPotionReport(result, config);
writeFileSync(path, report);
console.log(report.split('## Partner level')[0]);
console.log(`${String(battles)} battles in ${seconds.toFixed(1)} s. Report: ${path}`);
