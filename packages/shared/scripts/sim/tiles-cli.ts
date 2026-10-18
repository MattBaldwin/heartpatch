/**
 * `pnpm sim:tiles`: the tiles sim (#529). `--bonus <n>` tries another
 * `guardLevel.partnerBonus`, `--bonus none` plays without the floor (before
 * #529). Writes `tiles-report.md` to `reports/sim/` (git-ignored), or to
 * `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { renderTileReport, runTileSim } from './tiles.js';
import { TILE_SIM_CONFIG, type TileSimConfig } from './tiles-config.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: resolve(repoRoot, 'reports/sim') },
    bonus: { type: 'string' },
  },
});
const bonus = values.bonus;
if (bonus !== undefined && bonus !== 'none' && !/^\d+$/.test(bonus)) {
  throw new Error(`--bonus takes a whole number or "none", got "${bonus}"`);
}
const config: TileSimConfig = {
  ...TILE_SIM_CONFIG,
  ...(bonus !== undefined && { partnerBonus: bonus === 'none' ? null : Number(bonus) }),
};
const outDir = resolve(values.out);

const started = performance.now();
const result = runTileSim(config);
const seconds = (performance.now() - started) / 1000;
const battles = result.rows
  .filter((r) => r.partnerLevel === 'all')
  .reduce((sum, r) => sum + r.battles, 0);

mkdirSync(outDir, { recursive: true });
const path = resolve(outDir, 'tiles-report.md');
const report = renderTileReport(result, config);
writeFileSync(path, report);
console.log(report.split(/\n## Stance \w+, Partner level/)[0]);
console.log(`${String(battles)} battles in ${seconds.toFixed(1)} s. Report: ${path}`);
