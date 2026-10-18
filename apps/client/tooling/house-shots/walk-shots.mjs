/* global process, console, window, document, setTimeout, URLSearchParams */
// MOCKUP (#381 Keeper walk, branch issue-381-keeper-walk-mockup, no PR): the
// Keeper walking about the house, over the dev gallery (`/house.html`, the
// real house screen and engine with a sample house, no server). Each shot
// walks in with the Walk in button, puts the Keeper on its spot (dev hook)
// and then holds a real one-finger drag (the joystick) for a few frames, and
// captures mid-walk with the drag still held. The ?fps=1 badge stays in.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.walk-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const DEVICES = {
  iphone: { width: 390, height: 844, dpr: 3 },
  ipad: { width: 820, height: 1180, dpr: 2 },
};
const PI = Math.PI;
const SPOTS = {
  snug: { level: 1, put: null, drag: [40, -60] },
  playroom: { level: 4, put: { x: 6.4, z: 1.6, y: 0, yaw: PI }, drag: [45, -55] },
  hall: { level: 4, put: { x: 4.5, z: 7.0, y: 0, yaw: PI }, drag: [60, -20] },
  stairs: { level: 4, put: { x: 8.98, z: 7.0, y: 1.15, yaw: PI }, drag: [0, -70] },
  kitchen: { level: 4, put: { x: 2.4, z: 3.3, y: 3, yaw: PI }, drag: [-40, -35] },
};
const only = (key, all) => (process.env[key] ? process.env[key].split(',') : all);
const spots = only('SPOTS', Object.keys(SPOTS));
const devices = only('DEVICES', ['iphone', 'ipad']);
const minutes = only('MINUTES', ['720', '1200']);
const tier = process.env.TIER ?? 'high';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, timeout = 300_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 60)}`);
    await wait(300);
  }
}
const draws = (page) => page.evaluate(() => window.__heartpatch.draws());
async function frames(page, n) {
  // Render on demand: an idle house (low tier, no flicker) draws nothing until asked.
  const at = await draws(page);
  await until(
    page,
    (k) => {
      window.__heartpatch.invalidate();
      return window.__heartpatch.draws() >= k;
    },
    at + n,
  );
}

/** Slows the page's frame clock (the transition only): SwiftShader draws a frame in ~0.5 s, so the 0.9 s walk-in would be one frame. */
function slowClock(k) {
  const raf = window.requestAnimationFrame.bind(window);
  let t0 = null;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      t0 ??= t;
      cb(t0 + (t - t0) * k);
    });
}

async function open(device, minute, level, slow = 0) {
  const d = DEVICES[device];
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240_000);
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  if (slow) await page.addInitScript(slowClock, slow);
  const q = new URLSearchParams({ level: String(level), tier, minute, fps: '1' });
  await page.goto(`${BASE}/house.html?${q}`, { waitUntil: 'load' });
  await until(page, () => window.__heartpatch?.house?.()?.scene && window.__heartpatch.draws() > 0);
  await until(page, () => window.__heartpatch.house()?.pose === 'dollhouse');
  return { ctx, page, d };
}

async function badge(page) {
  return page.evaluate(() => {
    const n = document.querySelector('.dev-status, .dev-overlay, [data-testid="dev-status"]');
    return n ? n.textContent.trim().replace(/\s+/g, ' ') : null;
  });
}

const results = [];
async function shot(spotName, device, minute) {
  const spot = SPOTS[spotName];
  const time = minute === '720' ? 'day' : 'night';
  const file = `walk-${spotName}-${time}-${device}.png`;
  const { ctx, page, d } = await open(device, minute, spot.level);
  await page.getByTestId('house-walk').click();
  await until(page, () => window.__heartpatch.house()?.pose === 'kid', undefined, 120_000);
  if (spot.put) {
    await page.evaluate((p) => window.__heartpatch.walkPut(p, p.yaw), spot.put);
    await frames(page, 8);
  }
  // A real one-finger drag (the joystick), held while the shot is taken.
  const x0 = d.width * 0.3;
  const y0 = d.height * 0.72;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + spot.drag[0] * 0.5, y0 + spot.drag[1] * 0.5, { steps: 3 });
  await page.mouse.move(x0 + spot.drag[0], y0 + spot.drag[1], { steps: 3 });
  await frames(page, Number(process.env.WALK_FRAMES ?? 6));
  const house = await page.evaluate(() => window.__heartpatch.house());
  const b = await badge(page);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.mouse.up();
  await ctx.close();
  const rec = {
    file,
    spot: spotName,
    device,
    time,
    tier,
    badge: b,
    keeper: house.keeperWalk,
    lights: house.scene.lights,
    sceneDrawCalls: house.scene.drawCalls,
    triangles: house.scene.triangles,
    frontWallAlpha: house.scene.frontWallAlpha,
    floor: house.scene.floor,
  };
  console.log(JSON.stringify(rec));
  results.push(rec);
}

async function transition(device) {
  const { ctx, page } = await open(device, '1200', 1, 0.12);
  await page.getByTestId('house-walk').click();
  for (let i = 0; i < 12; i++) {
    const h = await page.evaluate(() => window.__heartpatch.house());
    const file = `walk-transition-${i}-${device}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    results.push({
      file,
      spot: 'transition',
      device,
      zoom: h.zoom,
      pose: h.pose,
      badge: await badge(page),
    });
    console.log(file, h.zoom);
    if (h.pose === 'kid') break;
    await frames(page, 1);
  }
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
for (const device of devices) {
  if (process.env.SHOTS !== '0')
    for (const s of spots)
      for (const m of minutes) {
        try {
          await shot(s, device, m);
        } catch (err) {
          console.log(`[${s} ${device} ${m}] failed: ${err.message}`);
        }
      }
  if (process.env.TRANSITION !== '0')
    await transition(device).catch((e) => console.log('transition failed', e.message));
}
await writeFile(path.join(OUT, 'captures.json'), `${JSON.stringify(results, null, 2)}\n`);
await browser.close();
