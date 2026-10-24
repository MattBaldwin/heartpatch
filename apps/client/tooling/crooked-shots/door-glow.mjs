/* global process, console, window, document, setTimeout, fetch, crypto */
// Captures the woken power doors' glow (#306 door glow) from the real game at
// iPhone sizes, for the owner: each of the four doors asleep (with its "who
// can help" bubble), then just woken. Dev tooling only, beside `bonus.mjs`
// (whose helpers it repeats, short): `node tooling/crooked-shots/door-glow.mjs`
// with the dev servers running (`pnpm dev`, `HP_DEV_SQUISHY_GRANTS=true`).
//
// Honest captures (#335): every shot is at a `?tier=` pinned (`high` by
// default), which the file name says, from the same saved state on both
// phones, with each phone's notch and home bar as safe-area insets
// (Chromium's `Emulation.setSafeAreaInsetsOverride`). No fake clock: it starves
// rendering in SwiftShader (see bonus.mjs), so a woken shot is taken a moment
// after the wake on the real clock. Headless SwiftShader says nothing about
// device frame times.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.crooked-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const TIER = process.env.TIER ?? 'high';
const ALL_DEVICES = {
  iphone: { width: 393, height: 852, dpr: 3, insets: { top: 59, bottom: 34 } },
  se: { width: 375, height: 667, dpr: 2, insets: { top: 20, bottom: 0 } },
};
const DEVICES = (process.env.DEVICES ?? 'iphone,se').split(',');
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://heartpatch:heartpatch@localhost:5432/heartpatch';
const ONLY_POWERS = process.env.POWERS ? new Set(process.env.POWERS.split(',')) : null;
/** After the wake card is dismissed, real ms before the "just woken" shot (the pulse runs 2.4 s from the wake). */
const AFTER_WAKE = Number(process.env.AFTER_WAKE ?? 300);

/** The four power doors: the element's friend, the room I stand in, and where I stand to face the sleeping door. */
const POWERS = [
  { power: 'fire', dx: -1, dz: 0, species: 'candlekit', from: 'parlour', door: [-7.4, 0.2] },
  { power: 'leaf', dx: 1, dz: 0, species: 'mossmuffin', from: 'conservatory', door: [7.3, -0.1] },
  // By the east wall: further out, a crooked thing is nearer than the door.
  { power: 'water', dx: 1, dz: 0, species: 'puddlepuff', from: 'scullery', door: [1.6, 11.3] },
  // By the west wall: further out, the crooked bed is nearer than the door.
  { power: 'light', dx: -1, dz: 0, species: 'glowboo', from: 'blue-bedroom', door: [-8.1, 3.2] },
];

async function until(page, fn, arg, timeout = 180_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > end) {
      await page.screenshot({ path: path.join(OUT, 'timed-out.png') }).catch(() => undefined);
      throw new Error(`timed out: ${fn.toString().slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const hook = (page, name) => page.evaluate((n) => window.__heartpatch?.[n]?.() ?? null, name);
const house = (page) => hook(page, 'farHollowHouse');

async function ok(page, method, url, body) {
  const res = await page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(`/api/v1${url}`, {
        method,
        headers: {
          'x-requested-with': 'heartpatch',
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { method, url, body },
  );
  if (res.status >= 300) throw new Error(`${method} ${url}: ${JSON.stringify(res)}`);
  return res.body;
}

async function signUp(page, name) {
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
}

/** A new patch from the lobby, its starter Puddlepuff (a Water friend). */
async function makePatch(page, label) {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('heading', { name: 'Your patches' }).waitFor({ timeout: 60_000 });
  await lobby.getByRole('button', { name: 'Make a patch' }).click();
  await lobby.getByLabel('Patch name').fill(label);
  await lobby.getByRole('button', { name: 'Make it!' }).click();
  await lobby.getByRole('button', { name: 'Visit patch' }).click();
  const starter = page.getByTestId('starter-picker');
  await starter.getByRole('button', { name: /^Puddlepuff,/ }).click({ timeout: 90_000 });
  await starter.getByRole('button', { name: 'Choose Puddlepuff' }).click();
  await starter.getByRole('button', { name: 'Let’s go!' }).click({ timeout: 60_000 });
  return until(page, () => window.__heartpatch?.map?.()?.id);
}

/** The team: one friend of each power's element (the starter is the Water one). */
async function grantTeam(page, mapId) {
  const ids = {};
  const mine = await ok(page, 'GET', `/maps/${mapId}/jobs`);
  ids.water = mine.squishies[0].squishy.id;
  for (const p of POWERS.filter((x) => x.power !== 'water')) {
    const { squishy } = await ok(page, 'POST', `/maps/${mapId}/dev/squishies`, {
      speciesId: p.species,
      level: 12,
    });
    ids[p.power] = squishy.id;
  }
  return ids;
}

/** The team picked for a power: its friend first, then others to fill it out. */
async function teamFor(page, mapId, ids, power) {
  const rest = Object.entries(ids)
    .filter(([p]) => p !== power)
    .map(([, id]) => id);
  await ok(page, 'POST', `/maps/${mapId}/team`, { squishyIds: [ids[power], ...rest].slice(0, 3) });
}

/** A fresh house for `name` (dev database only), so every phone shows the same state. */
function resetHouse(name) {
  execFileSync('psql', [DATABASE_URL, '-v', `name=${name}`, '-f', '-'], {
    input: [
      "DELETE FROM far_hollow_rooms WHERE user_id IN (SELECT id FROM users WHERE username = :'name');",
      "DELETE FROM far_hollow_state WHERE user_id IN (SELECT id FROM users WHERE username = :'name');",
    ].join('\n'),
  });
}

async function settle(page, ms = 900) {
  await page.waitForTimeout(ms);
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await until(page, (n) => (window.__heartpatch?.draws?.() ?? 0) >= n, before + 2);
}

const place = (page, x, z) =>
  page.evaluate(({ x, z }) => window.__heartpatch?.farHollowDev?.().place(x, z), { x, z });

async function goInside(page) {
  await until(page, () => window.__heartpatch?.map?.()?.id, undefined, 30_000);
  await page.evaluate(() => window.__heartpatch?.farHollowDev?.().openSheet());
  await page.getByTestId('far-hollow-inside').click({ timeout: 60_000 });
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.scene?.rooms?.length > 0);
  await page.waitForTimeout(800);
}

/** Into the room before a power door, standing at it. */
async function toDoor(page, mapId, p) {
  await ok(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: p.from });
  const { user } = await ok(page, 'GET', '/me');
  await page.evaluate(
    ({ userId, id }) => {
      window.localStorage.setItem(`heartpatch.lastPatch.v1.${userId}`, id);
    },
    { userId: user.id, id: mapId },
  );
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  await goInside(page);
  await place(page, p.door[0], p.door[1]);
  await until(
    page,
    () => window.__heartpatch?.farHollowHouse?.()?.target?.state === 'sleeping',
    undefined,
    60_000,
  );
}

const hashes = new Map();
const stats = [];
async function shot(page, device, name) {
  await settle(page);
  await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
  const file = path.join(OUT, `${device}-glow-${name}-${TIER}.png`);
  const png = await page.screenshot({ path: file, type: 'png', timeout: 180_000 });
  const sha = createHash('sha256').update(png).digest('hex');
  const twin = hashes.get(sha);
  if (twin) throw new Error(`${path.basename(file)} duplicates ${twin}`);
  hashes.set(sha, path.basename(file));
  const h = await house(page);
  const quality = await hook(page, 'quality');
  const row = {
    file: path.basename(file),
    sha256: sha,
    device,
    tier: quality?.tier,
    pinned: quality?.pinned,
    room: h?.room,
    card: h?.card,
    target: h?.target,
    bubble: h?.bubble,
    bonus: h?.bonus,
  };
  stats.push(row);
  console.log(JSON.stringify(row));
}

/** A fresh context and page for one phone, signed in, its insets set. */
async function phonePage(device, statePath) {
  const size = ALL_DEVICES[device];
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.setDefaultNavigationTimeout(120_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { left: 0, right: 0, ...size.insets },
  });
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  return { context, page };
}

/** Walks into the sleeping door and back off, so its bubble says who can help. */
async function bump(page, p) {
  const stick = await page.getByTestId('crooked-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + p.dx * 40, sy - p.dz * 40, { steps: 3 });
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.bubble, undefined, 30_000);
  await page.mouse.up();
}

/** One power on one phone: asleep (with its bubble), then just woken. */
async function shootPower(page, device, mapId, ids, p) {
  await teamFor(page, mapId, ids, p.power);
  await toDoor(page, mapId, p);
  await bump(page, p);
  await shot(page, device, `${p.power}-asleep`);
  await page.getByTestId('crooked-action').dispatchEvent('click');
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.picker?.helpers?.length > 0);
  await page.getByTestId(`crooked-helper-${ids[p.power]}`).dispatchEvent('click');
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.powering);
  await until(page, () => !window.__heartpatch?.farHollowHouse?.()?.powering);
  await until(page, () => document.querySelector('[data-testid="crooked-card"]') !== null);
  await page.getByTestId('crooked-card-ok').dispatchEvent('click');
  await page.waitForTimeout(AFTER_WAKE);
  await shot(page, device, `${p.power}-woke`);
}

const args = process.env.PW_CHROMIUM_ARGS
  ? process.env.PW_CHROMIUM_ARGS.split(' ')
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args,
});

// One player, one patch and team, saved once: both phones show the same state.
const statePath = path.join(OUT, '.glow-state.json');
const savedPath = path.join(OUT, '.glow-saved.json');
let name = `glow_${Date.now().toString(36)}`;
let mapId;
let ids;
if (process.env.REUSE === '1') {
  ({ name, mapId, ids } = JSON.parse(await readFile(savedPath, 'utf8')));
} else {
  const first = ALL_DEVICES[DEVICES[0]];
  const context = await browser.newContext({
    viewport: { width: first.width, height: first.height },
    deviceScaleFactor: first.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signUp(page, name);
  mapId = await makePatch(page, 'Glow Patch');
  ids = await grantTeam(page, mapId);
  await context.storageState({ path: statePath });
  await writeFile(savedPath, JSON.stringify({ name, mapId, ids }));
  await context.close();
}

for (const device of DEVICES) {
  for (const p of POWERS) {
    if (ONLY_POWERS && !ONLY_POWERS.has(p.power)) continue;
    // Each power from the same fresh house, in a fresh context; shot again from the start if a page wobbles.
    for (let attempt = 1; ; attempt++) {
      resetHouse(name);
      const { context, page } = await phonePage(device, statePath);
      try {
        await shootPower(page, device, mapId, ids, p);
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        console.error(`[retry] ${device} ${p.power}: ${String(error).slice(0, 200)}`);
      } finally {
        await context.close();
      }
    }
  }
}
await writeFile(path.join(OUT, 'glow-stats.json'), JSON.stringify(stats, null, 2));
await browser.close();
