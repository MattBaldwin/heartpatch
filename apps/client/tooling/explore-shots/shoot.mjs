/* global process, console, window, document, setTimeout, fetch */
// Captures the explore view from the real game at iPhone and iPad sizes, for
// the owner to judge the look (#335). Dev tooling only:
// `node tooling/explore-shots/shoot.mjs` with the dev servers running
// (`pnpm dev`). It signs up a player per device, makes a patch, opens the
// home tile (a meadow) and shoots it at each sky and each quality tier.
//
// Honest captures (#335): every shot is taken at a tier pinned with the
// dev-only `?tier=` (the governor is off, so software rendering can't drop it
// to low) and its file name and stats say which. Headless Chromium here has
// no GPU: it draws with SwiftShader (software WebGL2), which `stats.json`
// records as `gpu: false`. Set PW_CHROMIUM_ARGS to a GPU-backed set of flags
// where a GPU exists. Frame times from SwiftShader say nothing about a device.
//
// The clock is pinned (Playwright's fake clock) so the sky is the one asked
// for. `CLIP=1` also records a walk-around: the clock steps 1/30 s a frame and
// every frame is saved, so `ffmpeg` can make a real-time clip of a scene that
// takes seconds a frame to draw.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.explore-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const QUALITY = Number(process.env.JPEG ?? 85);
const ALL_DEVICES = {
  // iPhone 15 (Playwright's device), and iPad 9th gen (10.2", 810×1080 points) held sideways.
  iphone: { width: 393, height: 852, dpr: 3 },
  ipad: { width: 1080, height: 810, dpr: 2 },
};
const DEVICES = (process.env.DEVICES ?? 'iphone,ipad').split(',');
const TIERS = (process.env.TIERS ?? 'high').split(',');
/** Patch-local times for each sky (EXPLORE_RULES.sky), well inside each phase. */
const ALL_SKIES = { day: '12:30', dusk: '18:00', night: '22:30' };
const SKIES = (process.env.SKIES ?? 'day,dusk,night').split(',');
const CLIP = process.env.CLIP === '1';
const CLIP_FRAMES = Number(process.env.CLIP_FRAMES ?? 150);
const TAG = process.env.TAG ?? 'shot';
// `TERRAIN=lake` turns the player's tiles in the dev database into that terrain before
// exploring (dev tooling only: the shots show a lake without playing to one).
const TERRAIN = process.env.TERRAIN ?? null;
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://heartpatch:heartpatch@localhost:5432/heartpatch';

function setTerrain(name) {
  if (!TERRAIN) return;
  // psql doesn't interpolate -v variables into -c, so the statement goes in on stdin.
  execFileSync(
    'psql',
    [DATABASE_URL, '-v', `terrain=${TERRAIN}`, '-v', `name=${name}`, '-f', '-'],
    {
      input:
        "UPDATE tiles SET terrain = :'terrain' WHERE owner_user_id IN (SELECT id FROM users WHERE username = :'name');",
    },
  );
}

/**
 * Polls `fn` in the page from here until it's truthy. (Playwright's own
 * waitForFunction polls on the page's timers, which the fake clock owns.)
 */
async function until(page, fn, arg, timeout = 180_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const hook = (page, name) => page.evaluate((n) => window.__heartpatch?.[n]?.() ?? null, name);

async function signUpAndMakePatch(page, name) {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByLabel('Family or invite code').fill(SIGNUP_CODE);
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill('squishy-secret');
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByText("I've saved it").click();
  await overlay.getByTestId('auth-code-done').click();
  // No story today (marked seen), straight to the Keeper pick.
  await page.evaluate(() =>
    fetch('/api/v1/cinematic/seen', {
      method: 'POST',
      headers: { 'x-requested-with': 'heartpatch' },
    }),
  );
  await page.reload({ waitUntil: 'load' });
  const picker = page.getByTestId('keeper-picker');
  await picker.waitFor({ timeout: 60_000 });
  await picker.getByRole('button').first().click();
  await picker.getByRole('button', { name: 'That’s me!' }).click();
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('heading', { name: 'Your patches' }).waitFor({ timeout: 60_000 });
  await lobby.getByRole('button', { name: 'Make a patch' }).click();
  await lobby.getByLabel('Patch name').fill('Clover Hollow');
  await lobby.getByRole('button', { name: 'Make it!' }).click();
  await lobby.getByRole('button', { name: 'Visit patch' }).click();
  const starter = page.getByTestId('starter-picker');
  await starter.getByRole('button', { name: /^Puddlepuff,/ }).click({ timeout: 90_000 });
  await starter.getByRole('button', { name: 'Choose Puddlepuff' }).click();
  await starter.getByRole('button', { name: 'Let’s go!' }).click({ timeout: 60_000 });
  await until(page, () => window.__heartpatch?.map?.()?.id);
}

/** Back on the patch after a reload (the game lands on the last patch), then Explore on the home tile. */
async function openExplore(page) {
  const lobby = page.getByTestId('lobby');
  const row = lobby.getByRole('button', { name: /Clover Hollow/ });
  await until(page, () => window.__heartpatch?.map?.()?.tiles > 0).catch(async () => {
    await row.click();
    await lobby.getByRole('button', { name: 'Visit patch' }).click();
  });
  await until(page, () => document.querySelector('canvas[data-ready="true"]') !== null);
  const explore = page.getByTestId('tile-explore');
  for (let i = 0; i < 10 && !(await explore.isVisible()); i++) {
    const box = await page.locator('#game').boundingBox();
    if ((await hook(page, 'map'))?.selected == null) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await explore.waitFor({ timeout: 15_000 }).catch(() => {});
  }
  await explore.click();
  await until(page, () => window.__heartpatch?.explore?.()?.scene?.keeper);
}

/** Draws a couple of frames and waits for them. */
async function settle(page, frames = 2) {
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await until(page, (n) => (window.__heartpatch?.draws?.() ?? 0) >= n, before + frames);
}

/** Today's date at a patch-local time, in UTC (the context's zone is UTC). */
const at = (hhmm) => new Date(`2026-10-14T${hhmm}:00Z`);

const args = process.env.PW_CHROMIUM_ARGS
  ? process.env.PW_CHROMIUM_ARGS.split(' ')
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const gpu = Boolean(process.env.PW_CHROMIUM_ARGS);
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args,
});
const stats = [];
for (const device of DEVICES) {
  const size = ALL_DEVICES[device];
  // `REUSE=1`: the player from the last run on this device (iterating on the look).
  // `SHARE=1`: one player for every device, so the same tile is shot at each size.
  const statePath = path.join(OUT, `.state-${process.env.SHARE === '1' ? 'shared' : device}.json`);
  const reuse = process.env.REUSE === '1' && (await stat(statePath).catch(() => null)) !== null;
  const context = await browser.newContext({
    ...(reuse ? { storageState: statePath } : {}),
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dpr,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Etc/UTC',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.clock.install({ time: at(ALL_SKIES.day) });
  await page.clock.resume();
  let name;
  if (reuse) {
    name = (await readFile(`${statePath}.name`, 'utf8')).trim();
  } else {
    name = `${TAG}_${Date.now().toString(36)}${device[0]}`;
    await signUpAndMakePatch(page, name);
    await context.storageState({ path: statePath });
    await writeFile(`${statePath}.name`, name);
  }
  setTerrain(name);
  for (const tier of TIERS) {
    for (const sky of SKIES) {
      const started = Date.now();
      await page.clock.setSystemTime(at(ALL_SKIES[sky]));
      await page.goto(`${BASE}/?tier=${tier}`, { waitUntil: 'load' });
      await openExplore(page);
      await page.waitForTimeout(1500);
      await settle(page);
      // Freeze the clock (and so the render loop) on the frame just drawn: ambient life
      // keeps a software renderer busy forever, and a screenshot waits for an idle frame.
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
      // The dev badges stay out of the picture (the file name and stats carry the tier).
      await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
      const file = path.join(OUT, `${TAG}-${device}-${tier}-${sky}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY, timeout: 180_000 });
      await page.clock.resume();
      const quality = await hook(page, 'quality');
      const e = await hook(page, 'explore');
      const row = {
        file: path.basename(file),
        device,
        tier: quality?.tier,
        pinned: quality?.pinned,
        pixelRatio: quality?.pixelRatio,
        gpu,
        renderer: await hook(page, 'renderer'),
        sky: e?.scene?.sky,
        drawCalls: e?.scene?.drawCalls,
        triangles: e?.scene?.triangles ?? null,
        keeperHeight: e?.scene?.keeperHeight ?? null,
        land: e?.scene?.land ?? null,
      };
      stats.push(row);
      console.log(JSON.stringify(row), `${Date.now() - started} ms`);
    }
  }
  if (CLIP) {
    // A walk-around on a stepped clock: tap-to-walk to a few points, a frame each 1/30 s.
    const tier = TIERS[0];
    await page.clock.setSystemTime(at(ALL_SKIES.day));
    await page.goto(`${BASE}/?tier=${tier}`, { waitUntil: 'load' });
    await openExplore(page);
    await settle(page);
    await page.clock.pauseAt(at('12:31'));
    const dir = path.join(OUT, `clip-${device}`);
    await mkdir(dir, { recursive: true });
    await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
    // Steer with the floating joystick (a held drag anywhere on the ground): a
    // little loop up the path, round to the left and back, as a player walks.
    const legs = [
      { frames: 50, dx: 0.15, dy: -1 },
      { frames: 40, dx: -0.8, dy: -0.5 },
      { frames: 35, dx: -1, dy: 0.4 },
      { frames: 30, dx: 0.3, dy: 1 },
      { frames: 25, dx: 0, dy: 0 },
    ];
    const box = await page.locator('#game').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.62;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    let frame = 0;
    for (const leg of legs) {
      if (leg.dx === 0 && leg.dy === 0) await page.mouse.up();
      else await page.mouse.move(cx + leg.dx * 40, cy + leg.dy * 40, { steps: 2 });
      for (let i = 0; i < leg.frames && frame < CLIP_FRAMES; i++) {
        await page.clock.runFor(33);
        await page.screenshot({
          path: path.join(dir, `f${String(frame).padStart(4, '0')}.jpg`),
          type: 'jpeg',
          quality: 80,
          timeout: 180_000,
        });
        frame++;
      }
    }
    console.log(`clip: ${frame} frames in ${dir}`);
  }
  await context.close();
}
await browser.close();
await writeFile(path.join(OUT, `${TAG}-stats.json`), JSON.stringify(stats, null, 2));
console.log(`wrote ${stats.length} shots to ${OUT}`);
