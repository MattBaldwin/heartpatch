/* global process, console, window, setTimeout, URLSearchParams */
// Captures the Keeper walking about the house (#381 W2) for the owner to
// judge, over the dev gallery (`/house.html`: the real house screen and
// engine with a sample house, no server). Dev tooling only:
// `node tooling/house-shots/walk-shots.mjs` with the client dev server
// running (BASE, default http://localhost:5173). Writes PNGs and
// walk-captures.json to OUT (default .walk-shots).
//
// Shots: the dollhouse with Walk in; mid-glide (a slowed frame clock, so
// the 1.2 s glide is many frames) with the wall it passes faded; the follow
// view in the Hall and the Playroom; a real one-finger drag held (the
// joystick); Step out. Headless Chromium draws with SwiftShader, so frame
// times mean nothing. No dev badge unless FPS=1 (then the badge shot shows
// it clear of the room pill).
//
// W3 adds: the dollhouse upstairs; the Snug toward its doorway into the
// Hall; the Keeper half way up the stairs, on the walkway down to the
// Kitchen loft, and in the Kitchen looking at its doorway.
//
// DEVICES (iphone,se,ipad), SHOTS (dollhouse,glide,hall,playroom,stick,out,badge,
// upstairs,snug-door,stairs,walkway,kitchen), TIER (high), MINUTE (1080) narrow the set.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.walk-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const DEVICES = {
  iphone: { width: 393, height: 852, dpr: 3 },
  se: { width: 375, height: 667, dpr: 2 },
  ipad: { width: 820, height: 1180, dpr: 2 },
};
const only = (key, all) => (process.env[key] ? process.env[key].split(',') : all);
const devices = only('DEVICES', Object.keys(DEVICES));
const shots = only('SHOTS', [
  'dollhouse',
  'glide',
  'hall',
  'playroom',
  'stick',
  'out',
  'badge',
  'upstairs',
  'snug-door',
  'stairs',
  'walkway',
  'kitchen',
]);
const tier = process.env.TIER ?? 'high';
const minute = process.env.MINUTE ?? '1080';
/** The grown house (the Hall, the Playroom, the Kitchen loft) unless LEVEL says otherwise. */
const level = process.env.LEVEL ?? '4';

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
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
const house = (page) => page.evaluate(() => window.__heartpatch.house());

/** Renders `n` more frames (render on demand: an idle house draws nothing until asked). */
async function frames(page, n) {
  const at = await page.evaluate(() => window.__heartpatch.draws());
  await until(
    page,
    (k) => {
      window.__heartpatch.invalidate();
      return window.__heartpatch.draws() >= k;
    },
    at + n,
  );
}

/**
 * Slows the page's frame clock: SwiftShader takes ~0.5 s a frame, so the
 * glide would be two frames. `window.__clockRate` = 0 holds it still for a shot.
 */
function slowClock(k) {
  const raf = window.requestAnimationFrame.bind(window);
  window.__clockRate = k;
  let last = null;
  let at = 0;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      at += (t - (last ?? t)) * window.__clockRate;
      last = t;
      cb(at);
    });
}

async function open(device, { slow = 0, fps = false } = {}) {
  const d = DEVICES[device];
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240_000);
  page.on('pageerror', (e) => console.log(`[${device}] pageerror`, e.message));
  if (slow) await page.addInitScript(slowClock, slow);
  // `still` is reduced motion, which cuts Walk in too: the glide shot skips the entry glide with a tap.
  const q = new URLSearchParams({
    level,
    tier,
    minute,
    ...(!slow && { still: '1' }),
    ...(fps && { fps: '1' }),
  });
  await page.goto(`${BASE}/house.html?${q}`, { waitUntil: 'load' });
  await until(page, () => window.__heartpatch?.house?.()?.scene && window.__heartpatch.draws() > 0);
  if (slow) await page.touchscreen.tap(8, d.height * 0.4);
  await until(page, () => window.__heartpatch.house()?.pose === 'dollhouse');
  await frames(page, 2);
  return { ctx, page, d };
}

/**
 * Where the shots put the Keeper (dev hook). The Playroom spot stands it
 * behind a resident (the Playroom case: the resident fades).
 */
const SPOTS = {
  'heart-hall': null,
  playroom: { x: 6.9, z: 3.3 },
};

/**
 * The W3 shots' spots (shot → room and spot, a storey up with `y`): the
 * Snug's middle facing its back-right doorway into the Hall; half way up the
 * stairs; on the walkway by the west wall; in the Kitchen loft.
 */
const W3_SPOTS = {
  'snug-door': ['snug', { x: 3.0, z: 2.6 }],
  stairs: ['heart-hall', { x: 8.98, z: 7.6, y: 1.5 }],
  walkway: ['heart-hall', { x: 0.7, z: 6.9, y: 3 }],
  kitchen: ['kitchen', { x: 2.4, z: 3.0, y: 3 }],
};

/** Walks in with the button (the real control), settled at the follow camera. */
async function walkIn(page, room, spot = SPOTS[room]) {
  if (room) {
    const ok = await page.evaluate(
      ([r, on]) => window.__heartpatch.house().putKeeper(r, on ?? undefined),
      [room, spot],
    );
    if (!ok) throw new Error(`can't put the Keeper in ${room}`);
  }
  await page.getByTestId('house-walk').tap();
  await until(page, () => window.__heartpatch.house()?.pose === 'kid', undefined, 120_000);
  await frames(page, 4);
}

/** A real one-finger drag from (x0, y0) by (dx, dy), held for `n` frames. */
async function hold(page, x0, y0, dx, dy, n) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    });
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 4; i++) await touch('touchMove', x0 + (dx * i) / 4, y0 + (dy * i) / 4);
  await frames(page, n);
  return async () => {
    await touch('touchEnd');
    await cdp.detach();
  };
}

const results = [];
async function save(page, file, extra = {}) {
  const h = await house(page);
  await page.screenshot({ path: path.join(OUT, file) });
  const rec = {
    file,
    tier,
    pose: h.pose,
    zoom: Math.round(h.zoom * 100) / 100,
    walk: h.walk,
    drawCalls: h.scene.drawCalls,
    triangles: h.scene.triangles,
    lights: h.scene.lights,
    frontWallAlpha: h.scene.frontWallAlpha,
    ...extra,
  };
  console.log(JSON.stringify(rec));
  results.push(rec);
}

async function shoot(shot, device) {
  const name = `walk-${shot}-${device}.png`;
  if (shot === 'glide') {
    const { ctx, page } = await open(device, { slow: 0.04 });
    const room = process.env.GLIDE_ROOM ?? 'heart-hall';
    if (room !== 'none') await page.evaluate((r) => window.__heartpatch.house().putKeeper(r), room);
    await frames(page, 2);
    await page.getByTestId('house-walk').tap();
    // Mid-glide, where the camera passes the front wall.
    const want = Number(process.env.GLIDE_ZOOM ?? 0.7);
    await until(page, (z) => (window.__heartpatch.house()?.zoom ?? 0) >= z, want, 120_000);
    // Hold the clock there, and draw that moment.
    await page.evaluate(() => {
      window.__clockRate = 0;
    });
    await frames(page, 2);
    await save(page, name);
    await ctx.close();
    return;
  }
  const { ctx, page, d } = await open(device, { fps: shot === 'badge' });
  if (shot === 'dollhouse' || shot === 'badge') {
    await save(page, name);
  } else if (shot === 'upstairs') {
    await page.getByTestId('house-floor').tap();
    await frames(page, 4);
    await save(page, name);
  } else if (W3_SPOTS[shot]) {
    const [room, spot] = W3_SPOTS[shot];
    await walkIn(page, room, spot);
    await save(page, name, {
      floor: (await house(page)).floor,
      room: (await house(page)).walk?.room,
    });
  } else if (shot === 'hall' || shot === 'playroom') {
    await walkIn(page, shot === 'hall' ? 'heart-hall' : 'playroom');
    await save(page, name);
  } else if (shot === 'stick') {
    await walkIn(page, 'heart-hall');
    const end = await hold(page, d.width * 0.3, d.height * 0.66, 34, -40, 6);
    await save(page, name);
    await end();
  } else if (shot === 'out') {
    await walkIn(page, 'playroom');
    const end = await hold(page, d.width * 0.3, d.height * 0.66, 40, -10, 4);
    await end();
    await frames(page, 4);
    await page.getByTestId('house-walk').tap();
    await until(page, () => window.__heartpatch.house()?.pose === 'dollhouse', undefined, 120_000);
    await frames(page, 2);
    await save(page, name);
  }
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
for (const device of devices)
  for (const shot of shots) {
    try {
      await shoot(shot, device);
    } catch (err) {
      console.log(`[${shot} ${device}] failed: ${err.message}`);
    }
  }
await writeFile(path.join(OUT, 'walk-captures.json'), `${JSON.stringify(results, null, 2)}\n`);
await browser.close();
