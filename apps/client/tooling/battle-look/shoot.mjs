// Captures the battle look prototypes at iPhone and iPad sizes with headless
// Chromium (SwiftShader WebGL). Dev tooling only: `node tooling/battle-look/shoot.mjs`
// with the client dev server running on :5173. Writes JPEGs and a stats JSON
// into OUT (default .battle-look-shots in the cwd).
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.battle-look-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173/battle-look.html';
const DIRS = (process.env.DIRS ?? 'A,B,C').split(',');
const SHOTS = (
  process.env.SHOTS ??
  'idle,hud,fire-anticipation,fire-impact,fire-react,water-anticipation,water-impact,water-react,leaf-anticipation,leaf-impact,leaf-react,charm,ko'
).split(',');
const ALL_DEVICES = {
  iphone: { width: 390, height: 844, dpr: 2 },
  ipad: { width: 1180, height: 820, dpr: 2 },
};
const DEVICES = Object.fromEntries(
  (process.env.DEVICES ?? 'iphone,ipad').split(',').map((d) => [d, ALL_DEVICES[d]]),
);
const REDUCED = process.env.REDUCED !== '0';
const QUALITY = Number(process.env.JPEG ?? 78);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  // The container's preinstalled Chromium (PW_CHROMIUM_EXECUTABLE), or Playwright's own.
  ...(process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const stats = [];
for (const [device, size] of Object.entries(DEVICES)) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`[${m.type()}]`, m.text());
  });
  const jobs = [];
  for (const dir of DIRS) {
    for (const shot of SHOTS) jobs.push({ dir, shot, reduced: false });
    if (REDUCED) jobs.push({ dir, shot: 'fire-impact', reduced: true });
  }
  for (const job of jobs) {
    const url = `${BASE}?dir=${job.dir}&shot=${job.shot}${job.reduced ? '&reduced=1' : ''}&quality=high`;
    const name = `${job.dir}-${job.shot}${job.reduced ? '-reduced' : ''}-${device}`;
    const started = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('canvas[data-ready="true"]', { timeout: 180_000 });
    await page.waitForFunction(() => window.__heartpatchLook?.settled() === true, null, {
      timeout: 180_000,
    });
    const info = await page.evaluate(() => window.__heartpatchLook?.stats() ?? null);
    const file = path.join(OUT, `${name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY });
    stats.push({ name, dir: job.dir, shot: job.shot, device, reduced: job.reduced, ...info });
    console.log(
      `${name}  draws=${info?.drawCalls ?? '?'} active=${info?.activeMeshes ?? '?'} (${Date.now() - started} ms)`,
    );
  }
  await context.close();
}
await browser.close();
await writeFile(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));
console.log(`wrote ${stats.length} shots to ${OUT}`);
