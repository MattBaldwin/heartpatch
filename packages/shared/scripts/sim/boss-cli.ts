/**
 * `pnpm sim:boss` (#190): how often a team of 1–3 beats a mini-boss in the
 * team format, with the plan's gates. A soft gate: it prints PASS or FAIL
 * and always exits 0. Writes `boss-report.md` to `reports/sim/`
 * (git-ignored), or to `--out <dir>`; `--games <n>` plays fewer per cell.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BOSS_SIM_CONFIG } from './boss-config.js';
import { bossGates, renderBossSim, runBossSim } from './boss.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: resolve(repoRoot, 'reports/sim') },
    games: { type: 'string' },
  },
});
const outDir = resolve(values.out);
const config = {
  ...BOSS_SIM_CONFIG,
  ...(values.games !== undefined && { games: Number(values.games) }),
};

const started = performance.now();
const cells = runBossSim(config);
const gates = bossGates(cells, config);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'boss-report.md');
const report = renderBossSim(cells, gates, config);
writeFileSync(reportPath, report);
console.log(report);
console.log(`${String(cells.length)} cells in ${seconds.toFixed(1)} s. Report: ${reportPath}`);
