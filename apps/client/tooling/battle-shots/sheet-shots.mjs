/* global process, console, fetch, window, document */
// Captures the battle sheet (#656) at the phone sizes it has to fit, with the
// notch / home-bar insets emulated (Chromium's Emulation.setSafeAreaInsetsOverride,
// the same call battle-ui.spec.ts makes), for a squishy with 4 moves and one
// with 3: the idle pick on portrait phones and a turn mid-play on a landscape
// phone. Dev tooling only: `LABEL=after node tooling/battle-shots/sheet-shots.mjs`
// with the dev servers running (`pnpm dev` with HP_DEV_SQUISHY_GRANTS=true).
// Writes native PNGs named `<label>-<device>-<moves>.png` and a sheet.json of
// the sheet's and Run away's boxes into OUT. No dev tray or HUD is on screen:
// the battle fills the page, and the dev hooks drive it from outside.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.sheet-shots');
const LABEL = process.env.LABEL ?? 'after';
const BASE = process.env.BASE ?? 'http://localhost:5173';
const API = process.env.API ?? '/api/v1';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';

/** Insets in points, as the devices report them (portrait; a landscape phone puts its notch on the side). */
const DEVICES = [
  {
    id: 'iphone-15',
    name: 'iPhone 15 portrait',
    width: 393,
    height: 852,
    inset: { top: 59, bottom: 34, left: 0, right: 0 },
    turn: false,
  },
  {
    id: 'iphone-se',
    name: 'iPhone SE portrait',
    width: 375,
    height: 667,
    inset: { top: 20, bottom: 0, left: 0, right: 0 },
    turn: false,
  },
  {
    id: 'iphone-15-landscape',
    name: 'iPhone 15 landscape, mid-turn',
    width: 852,
    height: 393,
    inset: { top: 0, bottom: 21, left: 59, right: 59 },
    turn: true,
  },
];

/** A 4-move squishy and a 3-move one (species move lists, packages/shared/src/data/species.ts). */
const SQUISHIES = [
  { id: '4-moves', speciesId: 'splashmallow', level: 30 },
  { id: '3-moves', speciesId: 'puddlepuff', level: 30 },
];
const THEIRS = { speciesId: 'thistlepip', level: 3 };

/** Calls the API from the page (its own session cookie), like the e2e specs do. */
async function api(page, method, route, body) {
  return page.evaluate(
    async ({ method, route, body, base }) => {
      const res = await fetch(`${base}${route}`, {
        method,
        headers: {
          'x-requested-with': 'heartpatch',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    { method, route, body, base: API },
  );
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
  await overlay.getByLabel('A grown-up helped me and read the privacy page.').check();
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByText("I've saved it").click();
  await overlay.getByTestId('auth-code-done').click();
  // No story today (it's marked seen), straight to the Keeper pick.
  await api(page, 'POST', '/cinematic/seen');
  const picker = page.getByTestId('keeper-picker');
  await picker.getByRole('button', { name: 'Face: Apple', exact: true }).click();
  await picker.getByRole('tab', { name: 'Details' }).click();
  await picker.getByRole('button', { name: 'That’s me!' }).click();
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('heading', { name: 'Your patches' }).waitFor({ timeout: 30_000 });
  await lobby.getByRole('button', { name: 'Make a patch' }).click();
  await lobby.getByLabel('Patch name').fill('Lantern Hour');
  await lobby.getByRole('button', { name: 'Make it!' }).click();
  await lobby.getByRole('button', { name: 'Visit patch' }).click();
  const starter = page.getByTestId('starter-picker');
  await starter.getByRole('button', { name: /^Puddlepuff,/ }).click({ timeout: 60_000 });
  await starter.getByRole('button', { name: 'Choose Puddlepuff' }).click();
  await starter.getByRole('button', { name: 'Let’s go!' }).click({ timeout: 60_000 });
  await page
    .waitForFunction(() => window.__heartpatch?.map?.()?.id, null, { timeout: 60_000 })
    .catch(async (e) => {
      await page.screenshot({ path: '/tmp/claude-0/dbg.png' });
      throw e;
    });
  return hook(page, 'map').then((m) => m.id);
}

/** Ends the battle on the map, if any, so the next moment gets a fresh one. */
async function endCurrentBattle(page, mapId) {
  const current = await api(page, 'GET', `/maps/${mapId}/battles/current`);
  const battle = current.body?.battle;
  if (!battle || battle.status !== 'active') return;
  await api(page, 'POST', `/battles/${battle.id}/actions`, {
    action: { type: 'forfeit' },
    turn: battle.view.turn,
  });
}

async function openBattle(page, mapId, starterId, squishy, tier) {
  await endCurrentBattle(page, mapId);
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: squishy.speciesId,
    level: squishy.level,
  });
  if (granted.status !== 201) throw new Error(`grant: ${JSON.stringify(granted.body)}`);
  const team = await api(page, 'POST', `/maps/${mapId}/team`, {
    squishyIds: [granted.body.squishy.id, ...(starterId ? [starterId] : [])],
  });
  if (team.status !== 200) throw new Error(`team: ${JSON.stringify(team.body)}`);
  const started = await api(page, 'POST', `/maps/${mapId}/dev/battles`, { opponent: THEIRS });
  if (started.status !== 201 && started.status !== 200) {
    throw new Error(`battle: ${JSON.stringify(started.body)}`);
  }
  await page.goto(`${BASE}/?battle-clock=manual&battle-arena=meadow/day&quality=${tier}`, {
    waitUntil: 'load',
  });
  const lobby = page.getByTestId('lobby');
  const patchRow = lobby.getByRole('button', { name: /Lantern Hour/ });
  const hud = page.getByTestId('battle-hud');
  await hud.or(patchRow).first().waitFor({ timeout: 120_000 });
  if (await patchRow.isVisible()) {
    await patchRow.click({ timeout: 60_000 });
    await lobby.getByRole('button', { name: 'Visit patch' }).click({ timeout: 60_000 });
  }
  await hud.waitFor({ timeout: 120_000 });
  await page.waitForSelector('canvas[data-ready="true"]', { timeout: 180_000 });
  await page.waitForFunction(
    () => {
      const b = window.__heartpatch?.battle?.();
      return b && b.pending === 0 && !b.waiting && b.scene;
    },
    null,
    { timeout: 120_000 },
  );
}

/** Draws a couple of frames at the clock's time and waits for them. */
async function settleFrames(page) {
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await page.waitForFunction((n) => (window.__heartpatch?.draws?.() ?? 0) >= n + 2, before, {
    timeout: 120_000,
  });
}

/** The sheet, Run away and the lowest control, as the page lays them out. */
const boxes = (page) =>
  page.evaluate(() => {
    const box = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    const sheet = document.querySelector('[data-testid="battle-sheet"]');
    return {
      sheet: box('[data-testid="battle-sheet"]'),
      run: box('[data-testid="battle-run"]'),
      scrolls: sheet ? sheet.scrollHeight - sheet.clientHeight : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const report = [];
for (const device of DEVICES) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  // The dev stats badge (engine/dev-overlay.ts) is hidden: a capture shows the game, not the tooling.
  await page.addInitScript(() => {
    const hide = document.createElement('style');
    hide.textContent = '.dev-status, .dev-stats { display: none !important; }';
    document.addEventListener('DOMContentLoaded', () => document.head.append(hide));
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: device.inset });
  const mapId = await signUpAndMakePatch(
    page,
    `sheet_${Date.now().toString(36)}${device.id.length}`,
  );
  const care = await api(page, 'GET', `/maps/${mapId}/care`);
  const starterId = care.body?.squishies?.[0]?.id ?? null;
  for (const squishy of SQUISHIES) {
    await openBattle(page, mapId, starterId, squishy, 'high');
    const dev = (ms) => page.evaluate((t) => window.__heartpatch?.battleDev?.()?.set(t), ms);
    await dev(400);
    // The pick's sheet height, to compare with the same sheet while the turn plays.
    const pick = (await boxes(page)).sheet;
    if (device.turn) {
      // A move taps, the server answers, the log plays on the frozen clock: freeze 0.4 s in.
      await page.getByTestId('battle-move').first().click();
      await page.waitForFunction(
        () => {
          const b = window.__heartpatch?.battle?.();
          return b && !b.waiting && b.scene?.playing;
        },
        null,
        { timeout: 60_000 },
      );
      const t0 = (await hook(page, 'battle')).clock;
      await dev(t0 + 400);
    }
    await settleFrames(page);
    const file = `${LABEL}-${device.id}-${squishy.id}.png`;
    await page.screenshot({ path: path.join(OUT, file), type: 'png' });
    const b = await boxes(page);
    const clipped = b.run ? b.run.bottom - (b.viewport.height - device.inset.bottom) : null;
    report.push({
      file,
      device: device.name,
      moves: squishy.id,
      tier: 'high',
      ...b,
      pickHeight: pick?.height,
      clipped,
    });
    console.log(
      `${file}  run.bottom=${b.run?.bottom} over-inset=${clipped} scrolls=${b.scrolls} sheet=${b.sheet?.height} (pick ${pick?.height})`,
    );
  }
  await context.close();
}
await browser.close();
await writeFile(path.join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));
