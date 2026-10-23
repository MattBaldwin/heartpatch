/* global process, console, window, setTimeout, fetch, crypto */
// Captures the Crooked House's bonus rooms (#306 6e) from the real game at
// iPhone sizes, for the owner: a sleeping door, "Who can help?", each of the
// four powers mid-moment and the room it opens, a chest opening (common and
// with its rare friend), and the friend's battle. Dev tooling only, beside
// `shoot.mjs`: `node tooling/crooked-shots/bonus.mjs` with the dev servers
// running (`pnpm dev`, `HP_DEV_SQUISHY_GRANTS=true`).
//
// Which chest holds a friend is the season's secret (rule 6), so a scout
// opens all four through the API first and makes new patches until one
// does; then each device plays that patch through the screen.
//
// Honest captures (#335): every shot is at a tier pinned with the dev-only
// `?tier=`, which the file name says. Headless Chromium draws with
// SwiftShader (software WebGL2); frame times here say nothing about a device.
// Shots are native-size PNGs, with each phone's notch and home bar given as
// safe-area insets (Chromium's `Emulation.setSafeAreaInsetsOverride`). Each
// power plays in a fresh browser context: one long 3× session drifts until a
// reload lands in the lobby.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const TRIES = Number(process.env.TRIES ?? 6);
/** Only these powers' rooms through the screen (all four by default; the scout still opens every chest). */
const ONLY_POWERS = process.env.POWERS ? new Set(process.env.POWERS.split(',')) : null;

/**
 * The four bonus doors: the element's friend, the room I stand in, where I
 * stand to face the sleeping door, and which way the joystick steps through.
 */
const POWERS = [
  {
    power: 'fire',
    species: 'candlekit',
    from: 'parlour',
    door: [-7.4, 0.2],
    dx: -1,
    dz: 0,
    room: 'inglenook',
  },
  {
    power: 'leaf',
    species: 'mossmuffin',
    from: 'conservatory',
    door: [7.3, -0.1],
    dx: 1,
    dz: 0,
    room: 'hanging-garden',
  },
  {
    power: 'water',
    species: 'puddlepuff',
    from: 'scullery',
    door: [0.9, 11.3],
    dx: 1,
    dz: 0,
    room: 'pantry',
  },
  {
    power: 'light',
    species: 'glowboo',
    from: 'blue-bedroom',
    door: [-7.4, 3.5],
    dx: -1,
    dz: 0,
    room: 'lantern-closet',
  },
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

async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(`/api/v1${url}`, {
        method,
        headers: {
          'x-requested-with': 'heartpatch',
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
}

async function ok(page, method, url, body) {
  const res = await api(page, method, url, body);
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

/** Runs from a chest friend's battle (the scout only meets it). */
async function runAway(page, battleId) {
  const { battle } = await ok(page, 'GET', `/battles/${battleId}`);
  await ok(page, 'POST', `/battles/${battleId}/actions`, {
    action: { type: 'forfeit' },
    turn: battle.view.turn,
  });
}

/** Through the API: every power door and chest. Which rooms' chests held a friend? */
async function scout(page, mapId, ids) {
  const friends = {};
  for (const p of POWERS) {
    await ok(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: p.from });
    await teamFor(page, mapId, ids, p.power);
    const door = {
      fire: 'inglenook-door',
      leaf: 'garden-door',
      water: 'pantry-door',
      light: 'closet-door',
    }[p.power];
    await ok(page, 'POST', `/maps/${mapId}/far-hollow/power`, { door, squishyId: ids[p.power] });
    await ok(page, 'POST', `/maps/${mapId}/far-hollow/enter`, { room: p.room, tiptoe: false });
    const opened = await ok(page, 'POST', `/maps/${mapId}/far-hollow/chest`, { room: p.room });
    friends[p.room] = opened.friend?.speciesId ?? null;
    if (opened.friend) await runAway(page, opened.friend.battleId);
  }
  return friends;
}

/** A fresh house for `name` (dev database only), so every device shows the same state. */
function resetHouse(name) {
  execFileSync('psql', [DATABASE_URL, '-v', `name=${name}`, '-f', '-'], {
    input: [
      "DELETE FROM far_hollow_rooms WHERE user_id IN (SELECT id FROM users WHERE username = :'name');",
      "DELETE FROM far_hollow_state WHERE user_id IN (SELECT id FROM users WHERE username = :'name');",
    ].join('\n'),
  });
}

let patchName = 'Bonus Patch 1';
async function goInside(page) {
  // Back on the patch after a reload (the game lands on the last one), or from the lobby.
  await until(page, () => window.__heartpatch?.map?.()?.id, undefined, 30_000).catch(async () => {
    const lobby = page.getByTestId('lobby');
    await lobby.getByRole('button', { name: new RegExp(patchName) }).click();
    await lobby.getByRole('button', { name: 'Visit patch' }).click();
    await until(page, () => window.__heartpatch?.map?.()?.id);
  });
  await page.evaluate(() => window.__heartpatch?.farHollowDev?.().openSheet());
  await page.getByTestId('far-hollow-inside').click({ timeout: 60_000 });
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.scene?.rooms?.length > 0);
  await page.waitForTimeout(800);
}

async function settle(page, ms = 900) {
  await page.waitForTimeout(ms);
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await until(page, (n) => (window.__heartpatch?.draws?.() ?? 0) >= n, before + 2);
}

const place = (page, x, z) =>
  page.evaluate(({ x, z }) => window.__heartpatch?.farHollowDev?.().place(x, z), { x, z });

/** Steers the joystick (`dx` east, `dz` north) until the server says I'm in `room`. */
async function walkInto(page, dx, dz, room) {
  const stick = await page.getByTestId('crooked-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx * 40, sy - dz * 40, { steps: 3 });
  await until(page, (r) => window.__heartpatch?.farHollowHouse?.()?.room === r, room, 60_000);
  await page.mouse.up();
}

/**
 * Shoots a moment `ms` after `start` (a tap) and whatever it waits on: the
 * page's clock is paused first, stepped exactly `ms`, held for the shot (a
 * screenshot at 3× takes longer than the moment itself), then runs on.
 */
async function moment(page, start, ms, take) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
  try {
    await start();
    await page.clock.runFor(ms);
    await take();
    // The rest of the moment (and a card's timer) runs on the paused clock before it flows again.
    await page.clock.runFor(2_000);
  } finally {
    await page.clock.resume();
  }
}

const stats = [];
async function shot(page, device, name, { wait = true } = {}) {
  if (ONLY && !ONLY.has(name)) return;
  if (wait) await settle(page);
  await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
  const file = path.join(OUT, `${device}-bonus-${name}-${TIER}.png`);
  await page.screenshot({ path: file, type: 'png', timeout: 180_000 });
  const h = await house(page);
  const quality = await hook(page, 'quality');
  const row = {
    file: path.basename(file),
    device,
    tier: quality?.tier,
    pinned: quality?.pinned,
    room: h?.room,
    card: h?.card,
    ...h?.scene,
    bonus: h?.bonus,
  };
  stats.push(row);
  console.log(JSON.stringify(row));
}

/** Into the room before a power door, standing at it. */
async function toDoor(page, mapId, p, tries = 2) {
  await ok(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: p.from });
  // Land on this patch, even if a slow load made the lobby forget it (its resume threw).
  const { user } = await ok(page, 'GET', '/me');
  await page.evaluate(
    ({ userId, id }) => {
      window.localStorage.setItem(`heartpatch.lastPatch.v1.${userId}`, id);
    },
    { userId: user.id, id: mapId },
  );
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  try {
    await goInside(page);
    await place(page, p.door[0], p.door[1]);
    await until(
      page,
      () => window.__heartpatch?.farHollowHouse?.()?.target?.state === 'sleeping',
      undefined,
      60_000,
    );
  } catch (error) {
    // A reload now and then lands in the lobby (headless SwiftShader is slow): once more, fresh.
    if (tries <= 1) throw error;
    await toDoor(page, mapId, p, tries - 1);
  }
}

/** Opens the bonus room's chest from beside it, and shoots the lid, the card and any friend. */
async function openChest(page, device, name) {
  const h = await house(page);
  const chest = h.bonus.chests.find((c) => c.room === h.room);
  if (!chest) throw new Error(`no chest drawn in ${h.room}`);
  // Up to it, at its side (the friend hops out towards the camera).
  await place(page, chest.x - 1.0, chest.z - 0.6);
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.target?.kind === 'chest');
  await shot(page, device, `${name}-chest-shut`);
  await moment(
    page,
    async () => {
      await page.getByTestId('crooked-action').dispatchEvent('click');
      await until(page, () => window.__heartpatch?.farHollowHouse?.()?.card !== null);
    },
    // Mid-swing: the lid on its hinges, the coins showing.
    280,
    () => shot(page, device, `${name}-chest-opening`, { wait: false }),
  );
  await page.getByTestId('crooked-card').waitFor();
  await shot(page, device, `${name}-chest-card`);
}

const args = process.env.PW_CHROMIUM_ARGS
  ? process.env.PW_CHROMIUM_ARGS.split(' ')
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args,
});

// The scout: one player, new patches until a chest holds a friend.
const statePath = path.join(OUT, '.bonus-state.json');
const name = `bonus_${Date.now().toString(36)}`;
let mapId;
let ids;
let friends = {};
{
  const first = ALL_DEVICES[DEVICES[0]];
  const context = await browser.newContext({
    viewport: { width: first.width, height: first.height },
    deviceScaleFactor: first.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signUp(page, name);
  mapId = await makePatch(page, 'Bonus Patch 1');
  for (let i = 0; ; i++) {
    ids = await grantTeam(page, mapId);
    friends = await scout(page, mapId, ids);
    console.log(JSON.stringify({ mapId, friends }));
    if (Object.values(friends).some(Boolean) || i + 1 >= TRIES) break;
    // Another patch (a new season seed), through the API, and the game lands on it next load.
    const made = await ok(page, 'POST', '/maps', {
      name: `Bonus Patch ${String(i + 2)}`,
      timeZone: 'UTC',
    });
    mapId = made.map.id;
    patchName = `Bonus Patch ${String(i + 2)}`;
    await ok(page, 'POST', `/maps/${mapId}/starter`, { speciesId: 'puddlepuff' });
    await page.evaluate((id) => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('heartpatch.lastPatch.v1.')) window.localStorage.setItem(key, id);
      }
    }, mapId);
  }
  await context.storageState({ path: statePath });
  await context.close();
}
const friendRoom = Object.keys(friends).find((r) => friends[r]) ?? null;
if (!friendRoom) console.warn(`No chest held a friend in ${String(TRIES)} patches.`);

/** A fresh context and page for one phone, signed in, its insets set. */
async function phonePage(device) {
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
  // SwiftShader at 3× loads slowly.
  page.setDefaultNavigationTimeout(120_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { left: 0, right: 0, ...size.insets },
  });
  // A clock the shots can pause (it runs as usual otherwise).
  await page.clock.install();
  return { context, page };
}

for (const device of DEVICES) {
  // Every phone starts from the same house (the scout's patch and season).
  resetHouse(name);
  for (const p of POWERS) {
    if (ONLY_POWERS && !ONLY_POWERS.has(p.power)) continue;
    const { context, page } = await phonePage(device);
    await teamFor(page, mapId, ids, p.power);
    await toDoor(page, mapId, p);
    await shot(page, device, `${p.power}-asleep`);
    await page.getByTestId('crooked-action').dispatchEvent('click');
    await until(page, () => window.__heartpatch?.farHollowHouse?.()?.picker?.helpers?.length > 0);
    // The pictures come from the portrait renderer.
    await page.waitForTimeout(1500);
    await shot(page, device, `${p.power}-picker`);
    await moment(
      page,
      async () => {
        await page.getByTestId(`crooked-helper-${ids[p.power]}`).dispatchEvent('click');
        await until(page, () => window.__heartpatch?.farHollowHouse?.()?.powering);
      },
      850,
      () => shot(page, device, `${p.power}-power`, { wait: false }),
    );
    await until(page, () => !window.__heartpatch?.farHollowHouse?.()?.powering);
    // The payoff card (what the friend did), then the woken door itself.
    await page.getByTestId('crooked-card').waitFor();
    await shot(page, device, `${p.power}-woke`);
    await page.getByTestId('crooked-card-ok').dispatchEvent('click');
    await page.waitForTimeout(900);
    await shot(page, device, `${p.power}-open`);
    await walkInto(page, p.dx, p.dz, p.room);
    await page.waitForTimeout(600);
    await shot(page, device, `${p.power}-room`);
    const kind = p.room === friendRoom ? 'friend' : 'common';
    await openChest(page, device, `${p.power}-${kind}`);
    if (kind === 'friend') {
      await page.getByTestId('crooked-card-ok').dispatchEvent('click');
      await until(page, () => window.__heartpatch?.farHollowHouse?.()?.card === 'friend');
      await page.waitForTimeout(1500);
      await shot(page, device, 'friend-card');
      await page.getByTestId('crooked-card-ok').dispatchEvent('click');
      await until(
        page,
        () => window.__heartpatch?.battle?.()?.phase === 'turn',
        undefined,
        120_000,
      );
      await page.waitForTimeout(4000);
      await shot(page, device, 'friend-battle');
      const current = await ok(page, 'GET', `/maps/${mapId}/battles/current`);
      if (current.battle) await runAway(page, current.battle.id);
    } else {
      await page.getByTestId('crooked-card-ok').dispatchEvent('click');
      // This chest held a friend too (only one is shot): run from its battle, or it resumes on the next load.
      const current = await ok(page, 'GET', `/maps/${mapId}/battles/current`);
      if (current.battle) await runAway(page, current.battle.id);
    }
    await context.close();
  }
}
await writeFile(path.join(OUT, 'bonus-stats.json'), JSON.stringify(stats, null, 2));
await browser.close();
