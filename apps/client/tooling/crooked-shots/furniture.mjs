/* global process, console, window, setTimeout, fetch */
// Captures the Keeper bumping into the Crooked House's furniture (#651) from
// the real game at iPhone sizes, for the owner: walking north on the
// joystick into the Kitchen's counter and the Dining Room's table, and
// standing in the Dining Room's kitchen doorway. Dev tooling only, beside
// `shoot.mjs`: `node tooling/crooked-shots/furniture.mjs` with the dev
// servers running (`pnpm dev`). `BASE` points it at another client (main's,
// for the before shots); `LABEL` names that run's files.
//
// Every phone gets its own player, sent to each room by the dev route (every
// key turned, nothing put right), so every phone shows the same state. The
// Keeper is placed by the dev hook, then walks on the real joystick for the
// same time on every phone (the shot is taken with the stick still held), or
// on a real tap at the same spot on screen (the camera fits the room the same
// on both builds), shot partway and once it has arrived. Shots are
// native-size PNGs, with each phone's notch and home bar given as safe-area
// insets (Chromium's `Emulation.setSafeAreaInsetsOverride`).
//
// Honest captures (#335): every shot is at a tier pinned with the dev-only
// `?tier=`, which the file name says. Headless Chromium draws with
// SwiftShader (software WebGL2); frame times here say nothing about a device.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.crooked-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const LABEL = process.env.LABEL ?? 'after';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const TIER = process.env.TIER ?? 'high';
const ALL_DEVICES = {
  iphone: { width: 393, height: 852, dpr: 3, insets: { top: 59, bottom: 34 } },
  se: { width: 375, height: 667, dpr: 2, insets: { top: 20, bottom: 0 } },
};
const DEVICES = (process.env.DEVICES ?? 'iphone,se').split(',');
/** How long the joystick is held north before each walking shot, ms. */
const WALK_MS = Number(process.env.WALK_MS ?? 3000);
/** A tap-walk is shot this long after the tap, then again once it has arrived, ms. */
const TAP_MID_MS = Number(process.env.TAP_MID_MS ?? 1400);
const TAP_END_MS = Number(process.env.TAP_END_MS ?? 6000);

/**
 * The shots: the room the dev route sends me to, where the Keeper is
 * placed (floor metres), and whether it then walks north on the stick.
 */
const SHOTS = [
  // South of the Kitchen's tap counter (`tap` at the room's middle + [0.4, 2.1]).
  { name: 'kitchen-counter', room: 'kitchen', x: -5.2, z: 12.2, walk: true },
  // South of the Dining Room's table's east end, clear of the chairs knocked over in front of it.
  { name: 'dining-table', room: 'dining-room', x: -4.4, z: 4.3, walk: true },
  // In the Dining Room's doorway to the Kitchen (its north wall, 0.5 m west of the middle).
  { name: 'doorway', room: 'dining-room', x: -6.2, z: 8.5, walk: false },
  // South of the table's middle, then a tap on the floor behind it (page CSS px, per phone).
  {
    name: 'tap-round-table',
    room: 'dining-room',
    x: -5.7,
    z: 4.3,
    tap: { iphone: { x: 200, y: 235 }, se: { x: 190, y: 190 } },
  },
];

async function until(page, fn, arg, timeout = 180_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const house = (page) => page.evaluate(() => window.__heartpatch?.farHollowHouse?.() ?? null);

async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(`/api/v1${url}`, {
        method,
        headers: { 'x-requested-with': 'heartpatch', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

async function signUpAndMakePatch(page, name) {
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByLabel('Family or invite code').fill(SIGNUP_CODE);
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill('squishy-secret');
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByLabel('A grown-up helped me and read the privacy page.').check();
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByText("I've saved it").click();
  await overlay.getByTestId('auth-code-done').click();
  await page.evaluate(() =>
    fetch('/api/v1/cinematic/seen', {
      method: 'POST',
      headers: { 'x-requested-with': 'heartpatch' },
    }),
  );
  await page.reload({ waitUntil: 'load' });
  const picker = page.getByTestId('keeper-picker');
  await picker.waitFor({ timeout: 60_000 });
  await picker.getByRole('button', { name: 'Face: Apple', exact: true }).click();
  await picker.getByRole('tab', { name: 'Details' }).click();
  await picker.getByRole('button', { name: 'That’s me!' }).click();
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('heading', { name: 'Your patches' }).waitFor({ timeout: 60_000 });
  await lobby.getByRole('button', { name: 'Make a patch' }).click();
  await lobby.getByLabel('Patch name').fill('Crooked Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).click();
  await lobby.getByRole('button', { name: 'Visit patch' }).click();
  const starter = page.getByTestId('starter-picker');
  await starter.getByRole('button', { name: /^Puddlepuff,/ }).click({ timeout: 90_000 });
  await starter.getByRole('button', { name: 'Choose Puddlepuff' }).click();
  await starter.getByRole('button', { name: 'Let’s go!' }).click({ timeout: 60_000 });
  return until(page, () => window.__heartpatch?.map?.()?.id);
}

/** The sheet's "Go inside", into the house. */
async function goInside(page) {
  await until(page, () => window.__heartpatch?.map?.()?.id, undefined, 60_000);
  await page.evaluate(() => window.__heartpatch?.farHollowDev?.().openSheet());
  await page.getByTestId('far-hollow-inside').click({ timeout: 60_000 });
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.scene?.rooms?.length > 0);
  await page.waitForTimeout(800);
}

/** Reads away any lore page that's up, so it covers nothing. */
async function dismissLore(page) {
  for (let i = 0; i < 5; i++) {
    const close = page.getByTestId('lore-close');
    if (!(await close.isVisible().catch(() => false))) return;
    await close.click();
    await page.waitForTimeout(300);
  }
}

async function drawn(page) {
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await until(page, (n) => (window.__heartpatch?.draws?.() ?? 0) >= n, before + 2);
}

const rows = [];
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
await mkdir(OUT, { recursive: true });
for (const device of DEVICES) {
  const size = ALL_DEVICES[device];
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { left: 0, right: 0, ...size.insets },
  });
  const mapId = await signUpAndMakePatch(
    page,
    `fu_${LABEL[0]}${device[0]}${Date.now().toString(36)}`,
  );
  // Arrive at the far Hollow first; then the dev route sends me to each room.
  const arrived = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, {});
  if (arrived.status !== 201) throw new Error(JSON.stringify(arrived));
  for (const s of SHOTS) {
    const jump = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: s.room });
    if (jump.status !== 201) throw new Error(JSON.stringify(jump));
    await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
    await goInside(page);
    await dismissLore(page);
    await page.evaluate(({ x, z }) => window.__heartpatch?.farHollowDev?.().place(x, z), s);
    await page.waitForTimeout(600);
    await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
    if (s.walk) {
      const stick = await page.getByTestId('crooked-stick').boundingBox();
      const sx = stick.x + stick.width / 2;
      const sy = stick.y + stick.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx, sy - 40, { steps: 3 });
      await page.waitForTimeout(WALK_MS);
    }
    const frames = [s.name];
    if (s.tap) {
      const at = s.tap[device];
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(TAP_MID_MS);
      frames.push(`${s.name}-end`);
    }
    for (const name of frames) {
      if (name.endsWith('-end')) await page.waitForTimeout(TAP_END_MS - TAP_MID_MS);
      await drawn(page);
      const file = path.join(OUT, `${LABEL}-${device}-${name}-${TIER}.png`);
      await page.screenshot({ path: file });
      const h = await house(page);
      const row = { file: path.basename(file), device, room: h?.room, keeper: h?.keeper };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
    if (s.walk) await page.mouse.up();
  }
  await context.close();
}
await writeFile(path.join(OUT, `${LABEL}-stats.json`), JSON.stringify(rows, null, 2));
await browser.close();
