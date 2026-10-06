/**
 * `pnpm sim:map-fill`: how fast kids colour in a patch, and what land that
 * misses you gives back when someone stops playing. Runs every scenario under
 * every rule set and writes `map-fill-report.md` to `reports/sim/`
 * (git-ignored), or to `--out <dir>`. The same data and config always give
 * the same report.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MAP_FILL_CONFIG, MAP_FILL_RULES, MAP_FILL_SCENARIOS } from './map-fill-config.js';
import { awayTiles, renderMapFill, summariseMapFill } from './map-fill-report.js';
import { runMapFill, type MapFillRun } from './map-fill.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const runs: MapFillRun[] = [];
for (const scenario of MAP_FILL_SCENARIOS) {
  for (const rules of MAP_FILL_RULES) runs.push(runMapFill(scenario, rules, MAP_FILL_CONFIG));
}
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'map-fill-report.md');
writeFileSync(
  reportPath,
  renderMapFill(runs, MAP_FILL_RULES, {
    days: MAP_FILL_CONFIG.days,
    awayDays: MAP_FILL_CONFIG.awayDays,
    seconds,
  }),
);

console.log(`${String(runs.length)} runs in ${seconds.toFixed(1)} s.`);
for (const run of runs) {
  const s = summariseMapFill(run);
  const away = awayTiles(run, MAP_FILL_CONFIG.awayDays);
  const kept = away
    ? `, keeps ${away.away.map((a) => `${String(a.tiles)}@${String(a.days)}d`).join(' ')} of ${String(away.atStop)}`
    : '';
  console.log(
    `  ${s.scenario.padEnd(15)} ${s.rules.padEnd(14)} full day ${String(s.mapFull)}, ` +
      `nothing to claim ${s.nothingToClaim.join('/')} days, lost by players ${String(s.lostByPlayers)}${kept}`,
  );
}
console.log(`Report: ${reportPath}`);
