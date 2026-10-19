/**
 * `pnpm sim:hollowed` (#306): how many days a casual and an engaged kid,
 * alone and with a helper, take to restore their nearest Hollowed
 * Community of each size. Writes `hollowed-report.md` to `reports/sim/`
 * (git-ignored), or to `--out <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HOLLOWED_CONFIG } from './hollowed-config.js';
import { renderHollowed, runHollowed } from './hollowed.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { values } = parseArgs({
  options: { out: { type: 'string', default: resolve(repoRoot, 'reports/sim') } },
});
const outDir = resolve(values.out);

const started = performance.now();
const rows = runHollowed(HOLLOWED_CONFIG, PROGRESSION_CONFIG);
const seconds = (performance.now() - started) / 1000;

mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, 'hollowed-report.md');
writeFileSync(reportPath, renderHollowed(rows, HOLLOWED_CONFIG, { seconds }));

console.log(`${String(rows.length)} rows in ${seconds.toFixed(1)} s.`);
for (const r of rows) {
  const days = [...r.days].map(([n, d]) => `${String(n)} tiles ${String(d)} d`).join(', ');
  console.log(`  ${r.kid.padEnd(7)} ${r.team.padEnd(13)} ${days}`);
}
console.log(`Report: ${reportPath}`);
