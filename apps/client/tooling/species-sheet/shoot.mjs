/* global process, console, window, URL */
// Captures every form of a wave's new squishies for the species sheet (#382),
// each beside its nearest existing kind, as the real battle renderer draws
// them (`/roster.html`, the opponent's side of the arena, no HUD), at iPhone
// and iPad size. Dev tooling only: `node tooling/species-sheet/shoot.mjs`
// with the client dev server running (BASE, default http://localhost:5173).
// Writes one PNG per form and device, and captures.json, to OUT (default
// .species-sheet).
//
// Honest captures (#335): every shot pins its quality tier (the roster page
// reads it from `?quality=`; TIER, default high) and the file name and record
// say which. Headless Chromium here draws with SwiftShader, so frame times
// mean nothing. The reference squishy on the player's side is cropped out.
//
// WAVE (default 2) names the lines file (`wave-<n>.json` beside this script),
// TIER and DEVICES (iphone,ipad) narrow the set, IDS=a,b shoots just those
// species, RESUME=1 skips frames already in OUT, and TERRAIN/TIME choose the
// arena (meadow, day).
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.species-sheet');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const TIER = process.env.TIER ?? 'high';
const TERRAIN = process.env.TERRAIN ?? 'meadow';
const TIME = process.env.TIME ?? 'day';
/** Viewport, pixel ratio and the crop (CSS px) that frames the opponent and leaves the reference out. */
const DEVICES = {
  iphone: { width: 390, height: 844, dpr: 2, clip: { x: 60, y: 40, width: 330, height: 520 } },
  ipad: { width: 820, height: 1180, dpr: 2, clip: { x: 200, y: 40, width: 620, height: 780 } },
};
const devices = (process.env.DEVICES ?? 'iphone,ipad').split(',');

const here = path.dirname(new URL(import.meta.url).pathname);
const wave = JSON.parse(
  await readFile(path.join(here, `wave-${process.env.WAVE ?? '2'}.json`), 'utf8'),
);
const ids = process.env.IDS
  ? process.env.IDS.split(',')
  : [...new Set(wave.lines.flatMap((l) => [l.kind, l.kid, l.teen, l.nearest]))];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const records = [];
const jobs = ids.flatMap((id) => devices.map((device) => ({ id, device })));
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);

async function shoot({ id, device }) {
  // RESUME=1 keeps frames already written, so a stopped run can carry on.
  if (process.env.RESUME && existsSync(path.join(OUT, `${id}-${device}-${TIER}.png`))) return;
  const d = DEVICES[device];
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
  });
  try {
    const page = await ctx.newPage();
    const url = `${BASE}/roster.html?species=${id}&quality=${TIER}&terrain=${TERRAIN}&time=${TIME}${process.env.STUDIO ? '&studio' : ''}${process.env.ALONE ? '&alone' : ''}${process.env.SILHOUETTE ? '&silhouette' : ''}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__roster?.ready(), null, { timeout: 120_000 });
    await page.waitForTimeout(300);
    const file = `${id}-${device}-${TIER}.png`;
    await page.screenshot({ path: path.join(OUT, file), clip: d.clip, timeout: 120_000 });
    records.push({
      id,
      device,
      tier: TIER,
      file,
      width: d.clip.width,
      height: d.clip.height,
      dpr: d.dpr,
    });
    console.log('shot', file);
  } finally {
    await ctx.close();
  }
}

/** Software rendering is slow under load, so a timed-out frame gets two more tries. */
async function shootWithRetries(job) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await shoot(job);
    } catch (err) {
      if (attempt >= 3) {
        console.error('failed', job.id, job.device, String(err).split('\n')[0]);
        return;
      }
    }
  }
}
// A small worker pool, so one slow frame doesn't hold up the others.
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await shootWithRetries(job);
  }),
);
await browser.close();
const previous = await readFile(path.join(OUT, 'captures.json'), 'utf8').then(JSON.parse, () => []);
const merged = [...previous.filter((r) => !records.some((n) => n.file === r.file)), ...records];
await writeFile(path.join(OUT, 'captures.json'), JSON.stringify(merged, null, 2));
