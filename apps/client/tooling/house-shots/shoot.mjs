/* global process, console, window, document, setTimeout, URLSearchParams, innerWidth, innerHeight, WebGL2RenderingContext */
// Captures the real Keeper's house screen (#381) for the owner to judge:
// the dollhouse and kid height (Walk in), at iPhone and iPad sizes, at each quality tier, over a
// sample house from the dev gallery (`/house.html`, no server needed).
// Dev tooling only: `node tooling/house-shots/shoot.mjs` with the client
// dev server running (BASE, default http://localhost:5173). Writes PNGs
// and captures.json to OUT (default .house-shots).
//
// Honest captures (#335): every shot pins its tier (`?tier=`, governor off)
// and its file name and record say which. Headless Chromium here draws with
// SwiftShader (software WebGL2), so frame times mean nothing; the draw
// calls and triangles are counted from the WebGL calls themselves (shadow,
// scene and post passes) and hold on a device. No dev badges in the shots.
//
// LEVELS (default 1), POSES (dollhouse,kid,card), TIERS (high,low), DEVICES (iphone,ipad),
// MINUTES (720,1200: noon and night, minutes after midnight; #381 H2) narrow the set;
// a house of two floors shoots its dollhouse once per floor (the floor cut, B4: `-f1` is upstairs);
// `card` is the dollhouse with today's gift card open, `welcome` with welcome home's line (#381 H2),
// `picker` with the move-in picker open on the Playroom (C2b's framed room; B5a: the Snug's sign). GIFT=0 leaves the gift out
// (by default a resident's wrapped gift waits by its bed).
// ONLY=<regex> re-shoots matching files and merges them into captures.json.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.house-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const DEVICES = {
  iphone: { width: 390, height: 844, dpr: 3 },
  ipad: { width: 820, height: 1180, dpr: 2 },
};
/** The low tier's caps (house-config.ts HOUSE_BUDGET): every capture is checked against them. */
const LOW_BUDGET = { drawCalls: 60, triangles: 90_000, lights: 2 };
const only = (key, all) => (process.env[key] ? process.env[key].split(',') : all);
const levels = only('LEVELS', ['1']);
const tiers = only('TIERS', ['high', 'low']);
const devices = only('DEVICES', ['iphone', 'ipad']);
const poses = only('POSES', ['dollhouse', 'kid', 'card', 'welcome']);
const minutes = only('MINUTES', ['720', '1200']);
const gift = process.env.GIFT !== '0';
/** A capture's time of day, by its minute: noon is `day`, 8 pm `night`. */
const timeOf = (minute) => {
  const m = Number(minute);
  return m >= 7 * 60 && m < 17 * 60
    ? 'day'
    : m >= 17 * 60 && m < 19 * 60
      ? 'dusk'
      : m >= 6 * 60 && m < 7 * 60
        ? 'dawn'
        : 'night';
};
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);

/** Floors a level's dollhouse has (house-data: the Kitchen upstairs from level 3). */
const floorsAt = (level) => (Number(level) >= 3 ? [0, 1] : [0]);
const jobs = [];
for (const level of levels)
  for (const pose of poses)
    for (const floor of pose === 'dollhouse' ? floorsAt(level) : [0])
      // The gift card: once, at night (the card is DOM; the time of day is behind it).
      for (const minute of ['card', 'welcome', 'picker'].includes(pose) ? [minutes.at(-1)] : minutes)
        for (const tier of tiers)
          for (const device of devices)
            jobs.push({
              file: `house${level}-${pose}${floor > 0 ? `-f${floor}` : ''}-${timeOf(minute)}-${tier}-${device}.png`,
              level,
              pose,
              floor,
              minute,
              tier,
              device,
            });
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
if (ONLY) jobs.splice(0, jobs.length, ...jobs.filter((j) => ONLY.test(j.file)));

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function until(page, fn, arg, timeout = 300_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 60)}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Counts every WebGL draw and its triangles, frame by frame (installed before the page runs). */
function countDraws() {
  const gl = { draws: 0, triangles: 0, frame: { draws: 0, triangles: 0 } };
  window.__houseShotsGl = gl;
  const proto = WebGL2RenderingContext.prototype;
  const TRIANGLES = 4;
  const tris = (mode, n) => (mode === TRIANGLES ? n / 3 : 0);
  const wrap = (name, count) => {
    const original = proto[name];
    proto[name] = function (...a) {
      gl.draws += 1;
      gl.triangles += count(a);
      return original.apply(this, a);
    };
  };
  wrap('drawElements', (a) => tris(a[0], a[1]));
  wrap('drawArrays', (a) => tris(a[0], a[2]));
  wrap('drawElementsInstanced', (a) => tris(a[0], a[1]) * (a[4] ?? 1));
  wrap('drawArraysInstanced', (a) => tris(a[0], a[2]) * (a[3] ?? 1));
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      if (gl.draws > 0) gl.frame = { draws: gl.draws, triangles: Math.round(gl.triangles) };
      gl.draws = 0;
      gl.triangles = 0;
      cb(t);
    });
}

async function shoot(job) {
  const d = DEVICES[job.device];
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240_000);
  page.on('pageerror', (e) => console.log(`[${job.file}] pageerror`, e.message));
  await page.addInitScript(countDraws);
  const q = new URLSearchParams({
    level: job.level,
    tier: job.tier,
    still: '1',
    minute: job.minute,
    ...(gift && { gift: '1' }),
    ...(job.pose === 'welcome' && { welcome: '1' }),
    ...(job.pose === 'picker' && { picker: 'playroom' }),
  });
  await page.goto(`${BASE}/house.html?${q}`, { waitUntil: 'load' });
  await until(page, () => window.__heartpatch?.house?.()?.scene && window.__heartpatch.draws() > 0);
  if (job.floor > 0) {
    // Upstairs: the floor switch (the Kitchen's floor; the one below stays).
    await page.getByTestId('house-floor').click();
    await until(page, (f) => window.__heartpatch.house()?.scene?.floor === f, job.floor);
  }
  if (job.pose === 'kid') {
    // Walk in (the gallery's `still=1` cuts straight there, as reduced motion does).
    await page.getByTestId('house-walk').click();
    await until(page, () => window.__heartpatch.house()?.pose === 'kid');
  }
  if (job.pose === 'welcome') {
    // Welcome home: the first open of the day (the gallery keeps its line up).
    await until(page, () => window.__heartpatch.house()?.welcomed === true);
  }
  if (job.pose === 'picker') {
    // The move-in picker on the Playroom: the house framed above the open sheet (C2b).
    await until(page, () => window.__heartpatch.house()?.sheet === 'picker');
  }
  if (job.pose === 'card') {
    // Today's gift card, opened from the peek bar's gift line.
    await page.getByTestId('house-gift-line').click();
    await until(page, () => window.__heartpatch.house()?.sheet === 'gift');
  }
  // Frames drawn while shaders still compile skip meshes (SwiftShader
  // compiles slowly): redraw until two frames in a row draw the same.
  const frame = async () => {
    const before = await page.evaluate(() => window.__heartpatch.draws());
    await page.evaluate(() => window.__heartpatch.invalidate());
    await until(page, (n) => window.__heartpatch.draws() >= n, before + 2);
    return page.evaluate(() => window.__houseShotsGl.frame);
  };
  let gl = await frame();
  for (let i = 0; i < 12; i++) {
    const next = await frame();
    if (next.draws === gl.draws && next.triangles === gl.triangles && i > 0) break;
    gl = next;
  }
  await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
  const house = await page.evaluate(() => window.__heartpatch.house());
  const quality = await page.evaluate(() => window.__heartpatch.quality());
  // Nothing hangs off the screen and every button is 44 × 44 pt or more (style guide §3).
  const overflow = await page.evaluate(() => {
    const bad = [];
    for (const n of document.querySelectorAll('.house *')) {
      const r = n.getBoundingClientRect();
      if (r.width === 0) continue;
      if (
        r.left < -0.5 ||
        r.top < -0.5 ||
        r.right > innerWidth + 0.5 ||
        r.bottom > innerHeight + 0.5
      )
        bad.push(String(n.className || n.tagName));
    }
    for (const n of document.querySelectorAll('.house button')) {
      const r = n.getBoundingClientRect();
      if (r.width === 0) continue; // hidden (the floor switch in a one-floor house)
      if (r.width < 44 || r.height < 44) bad.push(`${n.className} is ${r.width}×${r.height}`);
    }
    return bad;
  });
  // HUD hints over a resident (B4 round 4: the chevron pill sat on a face): each shown
  // .house-more's rect against every resident's box on the screen.
  const uiOverlap = await page.evaluate((boxes) => {
    const hits = [];
    for (const n of document.querySelectorAll('.house-more')) {
      if (n.hidden) continue;
      const r = n.getBoundingClientRect();
      for (const b of boxes) {
        const x0 = b.x0 * innerWidth;
        const x1 = b.x1 * innerWidth;
        const y0 = b.y0 * innerHeight;
        const y1 = b.y1 * innerHeight;
        if (r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0)
          hits.push(`${n.className} over a resident`);
      }
    }
    return hits;
  }, house.faces?.boxes ?? []);
  await page.screenshot({ path: path.join(OUT, job.file), timeout: 240_000 });
  await ctx.close();
  const scene = house.scene;
  const rec = {
    file: job.file,
    level: house.level,
    rooms: house.rooms,
    pose: job.pose,
    minute: Number(job.minute),
    light: scene.light,
    gift: scene.gift,
    floor: scene.floor,
    floors: scene.floors,
    tier: quality?.tier,
    pinned: quality?.pinned,
    device: job.device,
    pixelRatio: quality?.pixelRatio,
    // Every WebGL draw and triangle in one frame (shadow, scene and post passes).
    drawCalls: gl.draws,
    triangles: gl.triangles,
    // The scene's own counters (main camera) for the same frame.
    sceneDrawCalls: scene.drawCalls,
    trianglesInView: scene.triangles,
    lights: scene.lights,
    shadowMap: scene.shadowMap,
    bloom: quality?.tier !== 'low',
    pitch: scene.pitch,
    frontWallAlpha: scene.frontWallAlpha,
    heroes: scene.heroes,
    facesVisible: house.faces ? `${house.faces.visible}/${house.faces.total}` : null,
    // Residents partly off the screen's edges (should be 0: the phone's frame edge falls between them).
    edgeCut: house.faces?.cut ?? null,
    uiOverlap,
    keeper: scene.keeper,
    ...(quality?.tier === 'low' && {
      lowBudget: {
        drawCalls: `${gl.draws}/${LOW_BUDGET.drawCalls}`,
        triangles: `${gl.triangles}/${LOW_BUDGET.triangles}`,
        lights: `${scene.lights}/${LOW_BUDGET.lights}`,
        within:
          gl.draws <= LOW_BUDGET.drawCalls &&
          gl.triangles <= LOW_BUDGET.triangles &&
          scene.lights <= LOW_BUDGET.lights,
      },
    }),
    ...(overflow.length > 0 && { overflow }),
  };
  console.log(JSON.stringify(rec));
  return rec;
}

await mkdir(OUT, { recursive: true });
const results = [];
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        results.push(await shoot(job));
      } catch (err) {
        console.log(`[${job.file}] failed: ${err.message}`);
      }
    }
  }),
);
if (ONLY) {
  const old = JSON.parse(await readFile(path.join(OUT, 'captures.json'), 'utf8').catch(() => '[]'));
  for (const r of old) if (!results.some((n) => n.file === r.file)) results.push(r);
}
results.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(path.join(OUT, 'captures.json'), `${JSON.stringify(results, null, 2)}\n`);
await browser.close();
console.log(`wrote ${results.length} shots to ${OUT}`);
