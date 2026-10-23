/* global process, console, window, setTimeout, fetch */
// Captures the Crooked House screen (#306 6c) from the real game at iPhone
// sizes, for the owner to judge against the approved design. Dev tooling
// only: `node tooling/crooked-shots/shoot.mjs` with the dev servers running
// (`pnpm dev`). It signs up a player per device, makes a patch, arrives at
// the far Hollow through the dev route, goes inside from the sheet, and puts
// rooms right through the real action button.
//
// The echoes and the peekaboo (#306 6d) are `ECHOES=1`'s own run: it
// jumps into the Stair Hall with every key turned (the dev route), pins
// where the echoes are drawn (`echoesAt`, so every phone shows the same
// moment), waits on the real clock for the server to catch me, and stops
// the peekaboo's clock at each frame (`peekAt`).
//
// The Relight boards and the story scraps (#306 6f) are `PUZZLES=1`'s run:
// the dev route puts the house right but the Library's board, the board is
// won through its real buttons with the server's dev answer, and the Music
// Room's board is relit with its room still to put right. With the Library
// the whole house is right, so the attic's big chest opens too.
//
// Honest captures (#335): every shot is at a tier pinned with the dev-only
// `?tier=`, which the file name says. Headless Chromium draws with
// SwiftShader (software WebGL2); frame times here say nothing about a device.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.crooked-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const QUALITY = Number(process.env.JPEG ?? 85);
const TIER = process.env.TIER ?? 'high';
const ALL_DEVICES = {
  iphone: { width: 393, height: 852, dpr: 3 },
  se: { width: 375, height: 667, dpr: 2 },
};
const DEVICES = (process.env.DEVICES ?? 'iphone,se').split(',');
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://heartpatch:heartpatch@localhost:5432/heartpatch';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const ECHOES = process.env.ECHOES === '1';
const PUZZLES = process.env.PUZZLES === '1';

async function until(page, fn, arg, timeout = 180_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 80)}`);
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
  // Back on the patch after a reload (the game lands on the last one), or from the lobby.
  await until(page, () => window.__heartpatch?.map?.()?.id, undefined, 20_000).catch(async () => {
    const lobby = page.getByTestId('lobby');
    await lobby.getByRole('button', { name: /Crooked Patch/ }).click();
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

/** Puts the room's crooked things right through the action button, until `stop` says so. */
async function fixRoom(page, stop) {
  for (;;) {
    const h = await house(page);
    const next = h.crooked.find((t) => t.kind !== 'relight');
    if (!next || h.card) return h;
    await place(page, next.x, next.z - 0.9);
    await until(page, (id) => window.__heartpatch?.farHollowHouse?.()?.target?.id === id, next.id);
    // A click with no press (as VoiceOver's) does a hold's thing too.
    await page.getByTestId('crooked-action').dispatchEvent('click');
    await until(page, () => !window.__heartpatch?.farHollowHouse?.()?.busy);
    const after = await house(page);
    if (stop(after)) return after;
  }
}

/** Out of the Front Hall's west door on the joystick, into the dark Parlour. */
/** Stands at (x, z) and steers `dx` (−1 west, 1 east) on the joystick until the server says I'm in `room`. */
async function walkThrough(page, x, z, dx, room) {
  await place(page, x, z);
  const stick = await page.getByTestId('crooked-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx * 40, sy, { steps: 3 });
  await until(page, (r) => window.__heartpatch?.farHollowHouse?.()?.room === r, room, 60_000);
  await page.mouse.up();
}

async function walkToParlour(page) {
  await place(page, -1.2, 0.3);
  const stick = await page.getByTestId('crooked-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx - 40, sy, { steps: 3 });
  await until(
    page,
    () => window.__heartpatch?.farHollowHouse?.()?.room === 'parlour',
    undefined,
    60_000,
  );
  await page.mouse.up();
}

/**
 * A fresh house for `name` on its patch (dev database only): every device
 * plays the same patch's season, so every capture shows the same state.
 */
function resetHouse(name) {
  execFileSync('psql', [DATABASE_URL, '-v', `name=${name}`, '-f', '-'], {
    input: [
      "DELETE FROM far_hollow_rooms WHERE user_id IN (SELECT id FROM users WHERE username = :'name');",
      "DELETE FROM far_hollow_state WHERE user_id IN (SELECT id FROM users WHERE username = :'name');",
      // The attic's run (#306 6f): its page and the cloak found afresh on every phone.
      ...(PUZZLES
        ? [
            "DELETE FROM lore_found WHERE user_id IN (SELECT id FROM users WHERE username = :'name');",
            "DELETE FROM clothing_owned WHERE item_id = 'lantern-keepers-cloak' AND user_id IN (SELECT id FROM users WHERE username = :'name');",
          ]
        : []),
    ].join('\n'),
  });
}

/**
 * Puts the room right up to its bloom card, reading each key card on the way
 * (a room may hide two). `onFirstKey` shoots the first one.
 */
async function toBloom(page, onFirstKey) {
  let keys = 0;
  for (;;) {
    const h = await fixRoom(page, (x) => x.card !== null);
    if (h.card !== 'key') return;
    if (keys++ === 0) await onFirstKey();
    await page.getByTestId('crooked-card-ok').click();
  }
}

const dev = (page, name, ...args) =>
  page.evaluate(({ name, args }) => window.__heartpatch?.farHollowDev?.()[name](...args), {
    name,
    args,
  });

/** The server time at which `loop` is `rooms` along its loop (a few laps on from now). */
async function echoTime(page, mapId, loop, rooms) {
  const view = await api(page, 'GET', `/maps/${mapId}/far-hollow`);
  const echo = view.body.house.echoes.find((e) => e.loop === loop);
  // CROOKED_HOUSE.echoLoops: [periodSeconds, rooms on the loop].
  const [period, n] = { 'stair-echo': [24, 2], 'bedroom-echo': [20, 2], 'music-echo': [28, 2] }[
    loop
  ];
  const laps = (rooms / n - echo.offset) * echo.direction;
  const now = Date.parse(view.body.house.serverTime);
  const base = Math.ceil(now / 1000 / period) * period;
  return (base + laps * period) * 1000;
}

/** How far the stair echo is from `room` (index on its loop, 0 or 1) on the real clock. */
async function gap(page, loop, index) {
  const e = (await house(page)).echoes.find((x) => x.loop === loop);
  const d = Math.abs(e.position - index) % 2;
  return Math.min(d, 2 - d);
}

/** Steers on the joystick (`dx`, `dy` of −1/0/1) until the server says I'm somewhere else or caught. */
async function steer(page, dx, dy) {
  const before = await house(page);
  const stick = await page.getByTestId('crooked-stick').boundingBox();
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx * 40, sy + dy * 40, { steps: 3 });
  await until(
    page,
    (b) => {
      const h = window.__heartpatch?.farHollowHouse?.();
      return h && (h.room !== b.room || (h.caught && h.caught !== b.caught) || h.peek);
    },
    { room: before.room, caught: before.caught },
    60_000,
  );
  await page.mouse.up();
}

/** The echoes and the peekaboo (#306 6d), from the same state on every phone. */
async function echoShots(page, device, mapId, calm) {
  const jump = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'stair-hall' });
  if (jump.status !== 201) throw new Error(JSON.stringify(jump));
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  await goInside(page);
  if (!calm) {
    // Idle: the stair echo hovers in the middle of the dark Stair Hall, its eyes over the dark.
    await place(page, 0.1, 3.4);
    await dev(page, 'echoesAt', await echoTime(page, mapId, 'stair-echo', 0.08));
    await shot(page, device, 'echo-idle');
    // Moving: halfway to the Dining Room, drifting through the doorway.
    await dev(page, 'echoesAt', await echoTime(page, mapId, 'stair-echo', 0.42));
    await shot(page, device, 'echo-moving');
    // At the Dining Room door: an echo close by past it, and Tiptoe would get me by.
    await place(page, -1.2, 5.0);
    await dev(page, 'echoesAt', await echoTime(page, mapId, 'stair-echo', 0.78));
    await shot(page, device, 'echo-hint');
    await dev(page, 'echoesAt', null);
    // Tiptoe past it for real: on, and in while it's near but drifting off.
    await page.getByTestId('crooked-tiptoe').dispatchEvent('click');
    for (;;) {
      const a = await gap(page, 'stair-echo', 1);
      await page.waitForTimeout(80);
      const b = await gap(page, 'stair-echo', 1);
      if (b > a && b > 0.17 && b < 0.24) break;
    }
    await steer(page, -1, 0);
    await until(
      page,
      () => window.__heartpatch?.farHollowHouse?.()?.room === 'dining-room',
      undefined,
      20_000,
    );
    await place(page, -3.6, 5.2);
    await dev(page, 'echoesAt', await echoTime(page, mapId, 'stair-echo', 0.86));
    await shot(page, device, 'tiptoe-past');
    await dev(page, 'echoesAt', null);
    await page.getByTestId('crooked-tiptoe').dispatchEvent('click');
    // Back in the Stair Hall for the catch (the dev route again: the same start on every phone).
    await page.getByTestId('crooked-back').click();
    const again = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'stair-hall' });
    if (again.status !== 201) throw new Error(JSON.stringify(again));
    await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
    await goInside(page);
  }
  // The catch: at the Stair Hall's west door, stepping into the Dining Room just as the echo's there.
  // Right at the doorway, as the echo drifts in towards the room's middle (software
  // rendering is slow, so the step takes a while).
  await place(page, -1.8, 5.0);
  await dev(page, 'peekAt', 0);
  for (;;) {
    const a = await gap(page, 'stair-echo', 1);
    await page.waitForTimeout(80);
    const b = await gap(page, 'stair-echo', 1);
    if (b < a && b > 0.04 && b < 0.18) break;
  }
  await steer(page, -1, 0);
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.peek);
  const frames = calm
    ? [
        [350, 'calm-fade'],
        [1300, 'calm-boo'],
      ]
    : [
        [480, 'peek-eyes'],
        [860, 'peek-boo'],
        [960, 'peek-shake'],
      ];
  for (const [ms, name] of frames) {
    await dev(page, 'peekAt', ms);
    await shot(page, device, name);
  }
  await dev(page, 'peekAt', 3200);
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.card === 'caught');
  await shot(page, device, calm ? 'calm-friendly' : 'peek-friendly');
  await dev(page, 'peekAt', null);
  await page.getByTestId('crooked-card-ok').click();
  await shot(page, device, calm ? 'calm-back' : 'back-in-light');
}

/** The board's cells, as the card draws them. */
const cell = (page, at) => page.getByTestId('hollowed-relight-board').locator('button').nth(at);

/** Plays `moves` (the server's dev answer) through the board's real buttons. */
async function playBoard(page, moves) {
  const before = (await house(page)).board?.moves ?? 0;
  for (const [i, move] of moves.entries()) {
    await cell(page, move.at).click();
    const picked = (await house(page)).board?.picked;
    if (move.type === 'slide' && picked === move.at) await cell(page, move.to).click();
    if (i < moves.length - 1) {
      await until(
        page,
        (n) => window.__heartpatch?.farHollowHouse?.()?.board?.moves === n,
        before + i + 1,
      );
    }
  }
}

/** Reads away any lore page a bloom found (the Lorebook's own card), so it covers nothing. */
async function dismissLore(page) {
  for (let i = 0; i < 5; i++) {
    const close = page.getByTestId('lore-close');
    if (!(await close.isVisible().catch(() => false))) return;
    await close.click();
    await page.waitForTimeout(300);
  }
}

/** Opens the Relight thing's board in the room I'm in (its big button), shooting it as it opens. */
async function openBoard(page, device, prefix) {
  await page.waitForTimeout(1500);
  await dismissLore(page);
  const thing = (await house(page)).crooked.find((t) => t.kind === 'relight');
  await place(page, thing.x, thing.z + 0.9);
  await until(page, (id) => window.__heartpatch?.farHollowHouse?.()?.target?.id === id, thing.id);
  await shot(page, device, `${prefix}-enter`);
  await page.getByTestId('crooked-action').click();
  await shot(page, device, `${prefix}-board-opens`, 120);
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.board?.card === 'board');
  await shot(page, device, `${prefix}-board`);
  return thing.id;
}

/** The Relight boards and the story scraps (#306 6f), from the same state on every phone. */
async function puzzleShots(page, device, mapId) {
  // The whole house right but the Library's reading lamps.
  const jump = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, {
    room: 'library',
    nearlyDone: true,
  });
  if (jump.status !== 201) throw new Error(JSON.stringify(jump));
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  await goInside(page);
  const lamps = await openBoard(page, device, 'library');
  const answer = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow/relight-answer`, {
    room: 'library',
    thing: lamps,
  });
  const half = Math.ceil(answer.body.moves.length / 2);
  await playBoard(page, answer.body.moves.slice(0, half));
  await shot(page, device, 'library-mid');
  await playBoard(page, answer.body.moves.slice(half));
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.card === 'bloom');
  await shot(page, device, 'library-bloom-opens', 120);
  await page.waitForTimeout(1200);
  await shot(page, device, 'library-bloom');
  await page.getByTestId('crooked-card-ok').click();
  await page.waitForTimeout(1500);
  await dismissLore(page);
  await shot(page, device, 'library-lit');

  // The whole house is right: up to the attic (the dev route, as the map walks to a lit room).
  await page.getByTestId('crooked-back').click();
  const up = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'attic' });
  if (up.status !== 201) throw new Error(JSON.stringify(up));
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  await goInside(page);
  await page.waitForTimeout(1500);
  await dismissLore(page);
  await shot(page, device, 'attic-enter');
  // Up to the big chest: its bubble says the page is ready.
  await place(page, 0, 5.0);
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.target?.kind === 'attic');
  await shot(page, device, 'attic-chest');
  await page.getByTestId('crooked-action').click();
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.scene?.attic?.open);
  await shot(page, device, 'attic-opens', 100);
  await until(page, () => !document.querySelector('[data-testid="crooked-card"]')?.hidden);
  await shot(page, device, 'attic-card-opens', 100);
  await page.waitForTimeout(1500);
  await dismissLore(page);
  await shot(page, device, 'attic-card');

  // The Music Room's music box, 6×6, with the room still to put right.
  resetHouse(name);
  const music = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'music-room' });
  if (music.status !== 201) throw new Error(JSON.stringify(music));
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  await goInside(page);
  const box = await openBoard(page, device, 'music');
  const tune = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow/relight-answer`, {
    room: 'music-room',
    thing: box,
  });
  await playBoard(page, tune.body.moves.slice(0, Math.ceil(tune.body.moves.length / 2)));
  await shot(page, device, 'music-mid');
  await playBoard(page, tune.body.moves.slice(Math.ceil(tune.body.moves.length / 2)));
  await until(page, () => window.__heartpatch?.farHollowHouse?.()?.board === null);
  await shot(page, device, 'music-relit', 100);
}

const stats = [];
async function shot(page, device, name, wait) {
  if (ONLY && !ONLY.has(name)) return;
  await settle(page, wait);
  await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
  const file = path.join(OUT, `${device}-${name}-${TIER}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY, timeout: 180_000 });
  const h = await house(page);
  const quality = await hook(page, 'quality');
  const row = {
    file: path.basename(file),
    device,
    tier: quality?.tier,
    pinned: quality?.pinned,
    room: h?.room,
    lit: h?.lit,
    ...h?.scene,
  };
  stats.push(row);
  console.log(JSON.stringify(row));
}

const args = process.env.PW_CHROMIUM_ARGS
  ? process.env.PW_CHROMIUM_ARGS.split(' ')
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args,
});
// One player and one patch for every device (sign up at the first device's size).
const statePath = path.join(OUT, '.state.json');
const name = `crook_${Date.now().toString(36)}`;
let mapId;
{
  const first = ALL_DEVICES[DEVICES[0]];
  const context = await browser.newContext({
    viewport: { width: first.width, height: first.height },
    deviceScaleFactor: first.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  mapId = await signUpAndMakePatch(page, name);
  await context.storageState({ path: statePath });
  await context.close();
}
for (const device of DEVICES) {
  const size = ALL_DEVICES[device];
  for (const motion of ['no-preference', 'reduce']) {
    if (motion === 'reduce' && ONLY && !ONLY.has('reduced') && !ECHOES) continue;
    if (motion === 'reduce' && PUZZLES) continue;
    const context = await browser.newContext({
      storageState: statePath,
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.dpr,
      isMobile: true,
      hasTouch: true,
      reducedMotion: motion,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    resetHouse(name);
    await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
    if (ECHOES) {
      await echoShots(page, device, mapId, motion === 'reduce');
      await context.close();
      continue;
    }
    if (PUZZLES) {
      await puzzleShots(page, device, mapId);
      await context.close();
      continue;
    }
    const arrived = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, {});
    if (arrived.status !== 201) throw new Error(JSON.stringify(arrived));
    await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
    await goInside(page);
    if (motion === 'reduce') {
      // Reduced motion: a cut to the Parlour, and its bloom at once (no roll of colour).
      await walkToParlour(page);
      await toBloom(page, async () => {});
      // The room in colour at once, the card read (its find is the server's roll, so it varies).
      while ((await house(page)).card) await page.getByTestId('crooked-card-ok').click();
      await shot(page, device, 'reduced');
      await context.close();
      continue;
    }
    // The arrival: the Front Hall (lit), the Brass door ahead, the keys HUD.
    await shot(page, device, 'arrival');
    await place(page, 0.2, 1.7);
    await until(page, () => window.__heartpatch?.farHollowHouse?.()?.target?.kind === 'door');
    await page.getByTestId('crooked-action').click();
    await shot(page, device, 'locked-door');
    await walkToParlour(page);
    await place(page, -6.4, 1.6);
    await shot(page, device, 'dark');
    // Tiptoe on: the light shrinks to a small ring.
    await page.getByTestId('crooked-tiptoe').dispatchEvent('click');
    await shot(page, device, 'tiptoe');
    await page.getByTestId('crooked-tiptoe').dispatchEvent('click');
    // Put the Parlour right: a key may turn up on the way, and the last thing blooms it.
    let keyShot = false;
    await toBloom(page, async () => {
      await shot(page, device, 'key');
      keyShot = true;
    });
    await page.waitForTimeout(1200);
    await shot(page, device, 'bloom');
    // Every card read (a second key may come with the bloom).
    while ((await house(page)).card) await page.getByTestId('crooked-card-ok').click();
    await shot(page, device, 'lit');
    await page.getByTestId('crooked-map').click();
    await page.waitForTimeout(1200);
    await shot(page, device, 'map');
    if (!keyShot && (!ONLY || ONLY.has('key'))) {
      // The Brass Key hides in the Parlour or the Conservatory: this season, the Conservatory.
      await page.getByTestId('crooked-back').click();
      await walkThrough(page, -3.4, 0.3, 1, 'front-hall');
      await walkThrough(page, 1.2, -0.2, 1, 'conservatory');
      await fixRoom(page, (x) => x.card === 'key');
      await page.waitForTimeout(1200);
      await shot(page, device, 'key');
    }
    await context.close();
  }
}
await writeFile(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));
await browser.close();
