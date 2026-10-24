/* global process, window */
// What the battle capture scripts share (shoot.mjs, framing.mjs): signing a
// player up, starting a dev battle, opening it on the manual battle clock and
// shooting a settled frame. Dev tooling only; see shoot.mjs for how to run.
import { chromium } from '@playwright/test';

export const BASE = process.env.BASE ?? 'http://localhost:5173';
// Through the client dev server's proxy, like the game itself (same origin).
export const API = process.env.API ?? '/api/v1';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const QUALITY = Number(process.env.JPEG ?? 80);

/** Headless Chromium with SwiftShader WebGL (the build container's preinstalled one by default). */
export function launch() {
  return chromium.launch({
    executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
    ],
  });
}

/** Calls the API from the page (its own session cookie), like the e2e specs do. */
export async function api(page, method, route, body) {
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

export const hook = (page, name) =>
  page.evaluate((n) => window.__heartpatch?.[n]?.() ?? null, name);

/** Sets (or reads) the frozen battle clock, ms. */
export const battleDev = (page, fn, ms) =>
  page.evaluate(({ fn, ms }) => window.__heartpatch?.battleDev?.()?.[fn](ms), { fn, ms });

export async function signUpAndMakePatch(page, name, base = BASE) {
  await page.goto(`${base}/`, { waitUntil: 'load' });
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByLabel('Family or invite code').fill(SIGNUP_CODE);
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill('squishy-secret');
  await overlay.getByLabel('Year you were born').selectOption('2014');
  // The grown-up tick (#593) wakes "Sign up"; then past the save-your-code screen (#197).
  await overlay.getByLabel('A grown-up helped me and read the privacy page.').check();
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByText("I've saved it").click({ timeout: 30_000 });
  await overlay.getByTestId('auth-code-done').click();
  // No story today (it's marked seen), straight to the Keeper pick (one step a screen, #372).
  await api(page, 'POST', '/cinematic/seen');
  const picker = page.getByTestId('keeper-picker');
  await picker.getByRole('button', { name: 'Face: Apple', exact: true }).click({ timeout: 60_000 });
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
  // The account's first pick shows Sprout's gift of Heart Charms first.
  await starter.getByRole('button', { name: 'Let’s go!' }).click({ timeout: 60_000 });
  await page.waitForFunction(() => window.__heartpatch?.map?.()?.id, null, { timeout: 120_000 });
  return hook(page, 'map').then((m) => m.id);
}

/** Ends the battle on the map, if any, so the next moment gets a fresh one. */
export async function endCurrentBattle(page, mapId) {
  const current = await api(page, 'GET', `/maps/${mapId}/battles/current`);
  const battle = current.body?.battle;
  if (!battle || battle.status !== 'active') return;
  await api(page, 'POST', `/battles/${battle.id}/actions`, {
    action: { type: 'forfeit' },
    turn: battle.view.turn,
  });
}

/** Starts a dev battle: `moment.mine` (granted fresh, leading the team) against `moment.theirs`. */
export async function startBattle(page, mapId, starterId, moment) {
  await endCurrentBattle(page, mapId);
  // The strongest resting squishy goes first: a fresh one at the wanted level.
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, moment.mine);
  if (granted.status !== 201) throw new Error(`grant: ${JSON.stringify(granted.body)}`);
  // It leads the team (the earlier moments' squishies would tie on strength), the starter behind it.
  const team = await api(page, 'POST', `/maps/${mapId}/team`, {
    squishyIds: [granted.body.squishy.id, ...(starterId ? [starterId] : [])],
  });
  if (team.status !== 200) throw new Error(`team: ${JSON.stringify(team.body)}`);
  const started = await api(page, 'POST', `/maps/${mapId}/dev/battles`, {
    opponent: moment.theirs,
  });
  if (started.status !== 201 && started.status !== 200) {
    throw new Error(`battle: ${JSON.stringify(started.body)}`);
  }
}

/**
 * Reloads with the manual clock and the arena override: the game lands back on
 * the last patch (#160) and the battle resumes. An older build (or a cleared
 * store) shows the lobby instead, so visit the patch from there if it does.
 * `tier` pins the quality tier (dev only, #335), so every capture names it.
 */
export async function showBattle(page, arena, { base = BASE, tier = 'high' } = {}) {
  await page.goto(`${base}/?battle-clock=manual&battle-arena=${arena}&tier=${tier}`, {
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

export async function openBattle(page, mapId, starterId, moment) {
  await startBattle(page, mapId, starterId, moment);
  await showBattle(page, moment.arena);
}

/** Draws a couple of frames at the clock's time and waits for them. */
async function settleFrames(page) {
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await page.waitForFunction((n) => (window.__heartpatch?.draws?.() ?? 0) >= n + 2, before, {
    timeout: 120_000,
  });
}

export async function shoot(page, file) {
  // The dev stats badges stay out of the picture (as in the other capture tools).
  await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
  await settleFrames(page);
  await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY });
  const battle = await hook(page, 'battle');
  return battle?.scene ?? null;
}
