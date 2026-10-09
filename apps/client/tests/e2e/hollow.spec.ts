import { findAvoidedWords, STARTERS } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { claimLand } from './claim-land.js';
import { api, hook, idle } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { closeTrays, trayButton } from './trays.js';

/**
 * The Hollow Man on an iPhone (issue #21): home is always safe (the Heart
 * Seed, #202), so a new player claims land and posts a guard out there;
 * with no fire lit on it they get a nudge to light one, and two nights of
 * grace (owner decision 2026-10-03). Then night falls (the dev route), he
 * walks the border in the night show (#277), takes the guard standing in
 * the dark to the Hollow, the morning report says so kindly and offers a
 * replay, and a rescue sets off from anywhere. Checked through the dev
 * hook's signals, never pixels or timing.
 */

/** `HollowDebug` from src/hollow/hollow-screen.ts (this project can't see its types). */
interface HollowDebug {
  mapId: string;
  night: boolean;
  hollowed: number;
  report: string[];
  sheetOpen: boolean;
  visiting: boolean;
  visits: number;
  rewardsLeftToday: number;
  fireHint: boolean;
  show: { playing: boolean; mode: 'live' | 'replay' | null; line: string; beats: number };
  chips: string[];
  strength: boolean;
  replay: boolean;
  darkSpots: number;
  walking: number;
}

/**
 * WebKit's page error for an in-flight API fetch that a reload aborts (on CI:
 * "…/localhost:5173/api/v1/milestones due to access control checks."), as in
 * cinematic.spec.ts.
 */
const ABORTED_FETCH = /\/api\/v1\/\S* due to access control checks\.?$/;

const hollowState = (page: Page) => hook<HollowDebug>(page, 'hollow');
const mapState = (page: Page) =>
  hook<{ id: string; live: string | null; selected: string | null }>(page, 'map');
const battleState = (page: Page) =>
  hook<{ status: string; scene: { squishies: number; shadowLook: number } | null }>(page, 'battle');

test('night falls, the Hollow Man visits, and a rescue sets off', async ({ browser }) => {
  test.setTimeout(240_000); // map and arena builds and a claim; CI renders in software
  const page = await newPlayer(browser, uniqueName('hollow'));
  // The map's ambient life (swaying trees, drifting motes) keeps a fast
  // renderer drawing; reduced motion holds it still, so "the map stops
  // drawing when he's gone" is about his visit alone.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  // Only an API fetch the reload below aborts is let through, and only while
  // reloading; every other page error stays fatal.
  let reloading = false;
  page.on('pageerror', (err) => {
    if (reloading && ABORTED_FETCH.test(err.message)) return;
    errors.push(err.message);
  });
  // A shader that doesn't compile only logs (the shadow look, owner decision 7).
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /shader|effect|compile/i.test(msg.text()))
      errors.push(msg.text());
  });

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Moonlit Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await mapState(page))?.live).toBe('live');
  const mapId = (await mapState(page))!.id;
  await expect
    .poll(() => hollowState(page))
    .toMatchObject({ mapId, hollowed: 0, report: [], visits: 0 });

  // Home is always safe: a squishy waiting by the Heart Seed is no worry, so no nudge.
  const hint = await trayButton(page, 'hollow-fire-hint');
  await expect(hint).toBeHidden();

  // Land of their own, and a guard out there with no fire lit: exposed.
  const land = await claimLand(page, mapId);
  // Capturing old forest finds a lore page (the-tidied-clearing), and so does
  // a squishy taken to the Hollow (grey-footprints, #307): the next map open
  // (the reloads below) would pop them over the trays and hold the morning
  // report back (one card at a time, #129). This test isn't about lore: mark
  // them shown, the way the lorebook does once a page's card has been seen.
  const me = (await api<{ user: { id: string } }>(page, 'GET', '/me')).body.user.id;
  await page.evaluate((key) => {
    const shown = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    localStorage.setItem(key, JSON.stringify([...shown, 'the-tidied-clearing', 'grey-footprints']));
  }, `heartpatch.lore.shown.${me}`);
  const squishy = { speciesId: STARTERS.speciesIds[0], level: 5 };
  const granted = await api<{ squishy: { id: string } }>(
    page,
    'POST',
    `/maps/${mapId}/dev/squishies`,
    squishy,
  );
  expect(granted.status).toBe(201);
  // On watch out there with no fire lit (owner decision 2026-10-07: guards need its light too).
  const posted = await api(page, 'POST', `/maps/${mapId}/defenders`, {
    ...land,
    squishyIds: [granted.body.squishy.id],
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  // The nudge, once the hollow status is read again (unless it's night on the server's clock).
  reloading = true;
  await page.reload();
  reloading = false;
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  if (!(await hollowState(page))!.night) {
    // The reload shut the trays: open the one the nudge lives in again.
    await trayButton(page, 'hollow-fire-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('A friend sleeps out in the dark. Light a fire there!');
    expect(findAvoidedWords((await hint.textContent()) ?? '')).toEqual([]);
  }

  // The guard's land is dark (#277): a chip counts it, and his stage chip
  // opens the "he gets bolder" sheet, in moons, never numbers.
  await expect.poll(async () => (await hollowState(page))?.darkSpots).toBe(1);
  const chips = page.getByTestId('night-chips');
  await expect(chips).toContainText(/He's \w+ tonight|1 dark spot/);
  // His stage is a tap away at any hour (at dusk, just his moon).
  await closeTrays(page);
  await page.getByTestId('night-stage-chip').tap();
  const strength = page.getByTestId('night-strength');
  await expect(strength).toBeVisible();
  await expect(strength).toContainText('The Hollow Man gets bolder');
  await expect(strength.getByTestId('night-stages').locator('li')).toHaveCount(4);
  await expect(strength).toContainText("Light every bit of your land and he can't get anything!");
  expect(findAvoidedWords((await strength.textContent()) ?? '')).toEqual([]);
  await strength.getByTestId('night-strength-ok').tap();
  await expect(strength).toBeHidden();

  // First-night grace: the first two nightfalls take nothing.
  for (let night = 0; night < 2; night++) {
    const graced = await api(page, 'POST', `/maps/${mapId}/dev/nightfall`);
    expect(graced).toMatchObject({ status: 200, body: { taken: 0 } });
  }
  // He walks the border live (#277), backing away from the light, with the
  // narrator (never him) saying so; Skip ends the show at once.
  await expect
    .poll(async () => (await hollowState(page))?.show.playing, { timeout: 30_000 })
    .toBe(true);
  expect((await hollowState(page))!.show.mode).toBe('live');
  await expect.poll(async () => (await hollowState(page))?.walking).toBeGreaterThan(0);
  const caption = page.getByTestId('night-caption');
  await expect(caption).toBeVisible();
  await expect(caption).toContainText('Night has come. The Hollow Man is out walking');
  expect(findAvoidedWords((await caption.textContent()) ?? '')).toEqual([]);
  await page.getByTestId('night-show-skip').tap();
  await expect(caption).toBeHidden();
  expect(await hollowState(page)).toMatchObject({ walking: 0, show: { playing: false } });
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
  // The quiet nights still teach (#134): the squishy was out in the dark and
  // he let it be, so the morning report says so and asks for a fire.
  const graceReport = page.getByTestId('hollow-report');
  await expect(graceReport).toBeVisible();
  await expect(graceReport).toContainText('took nobody this time');
  await expect(graceReport).toContainText('A friend sleeps out in the dark. Light a fire there!');
  expect(findAvoidedWords((await graceReport.textContent()) ?? '')).toEqual([]);
  expect(await hollowState(page)).toMatchObject({ hollowed: 0 });
  // Its land is still dark: "Light my land" goes there and opens its tile panel.
  await page.getByTestId('hollow-report-light').tap();
  await expect(graceReport).toBeHidden();
  await expect.poll(async () => (await mapState(page))?.selected).toBe(`${land.q},${land.r}`);
  await page.getByTestId('tile-panel').getByRole('button', { name: 'Close' }).tap();
  expect(await hollowState(page)).toMatchObject({ hollowed: 0, report: [] });
  // The raid report (#16) is open when night falls: the Hollow's report waits its turn.
  await (await trayButton(page, 'raid-open')).tap();
  const raidSheet = page.getByTestId('raid-report');
  await expect(raidSheet).toBeVisible();
  // He grows bolder night by night (#277): from night 3 a rising chance,
  // sure by night 6, of taking the guard out in the dark.
  const fall = () => api<{ taken: number }>(page, 'POST', `/maps/${mapId}/dev/nightfall`);
  let fell = await fall();
  for (let night = 3; night < 6 && fell.body.taken === 0; night++) {
    fell = await fall();
  }
  expect(fell).toMatchObject({ status: 200, body: { taken: 1 } });

  // He walks live each night. One card at a time: with the raid report open
  // the narrator waits its turn, and so does the report.
  await expect
    .poll(async () => (await hollowState(page))?.show.playing, { timeout: 30_000 })
    .toBe(true);
  await expect(caption).toBeHidden();
  const report = page.getByTestId('hollow-report');
  await expect(report).toBeHidden();
  await raidSheet.getByTestId('raid-done').tap();
  await expect(raidSheet).toBeHidden();
  await closeTrays(page);
  // Back on the map, the narrator comes back; skipped, the map stops drawing when he's gone.
  await expect(caption).toBeVisible();
  await page.getByTestId('night-show-skip').tap();
  await expect.poll(async () => (await hollowState(page))?.walking).toBe(0);
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
  // The morning report: gentle, and always "you can rescue them".
  await expect(report).toBeVisible();
  await expect(report).toContainText(
    /The Hollow Man (visited last night|came by while you were away)/,
  );
  await expect(report).toContainText('You can rescue them!');
  expect(findAvoidedWords((await report.textContent()) ?? '')).toEqual([]);
  expect(await hollowState(page)).toMatchObject({ hollowed: 1 });
  expect((await hollowState(page))!.report.length).toBeGreaterThan(0);
  // Skipped live, so no replay; a kid who missed it gets one at the top (#277).
  expect((await hollowState(page))!.replay).toBe(false);
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, `heartpatch.hollow.show.${me}.${mapId}`);
  reloading = true;
  await page.reload();
  reloading = false;
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(report).toBeVisible({ timeout: 30_000 });
  // Roomy: after a reload the map builds first, and CI renders in software.
  await expect.poll(async () => (await hollowState(page))?.replay, { timeout: 30_000 }).toBe(true);
  await page.getByTestId('hollow-report-replay').tap();
  // The same show, sped up: the report waits until it's over.
  await expect(report).toBeHidden();
  expect((await hollowState(page))!.show).toMatchObject({ playing: true, mode: 'replay' });
  await expect(caption).toBeVisible();
  await expect
    .poll(async () => (await hollowState(page))?.show.line, { timeout: 30_000 })
    .toContain('You can rescue them!');
  expect(findAvoidedWords((await caption.textContent()) ?? '')).toEqual([]);
  await expect
    .poll(async () => (await hollowState(page))?.show.playing, { timeout: 60_000 })
    .toBe(false);
  await expect(report).toBeVisible();
  expect((await hollowState(page))!.replay).toBe(false);
  // The capture's battle cooldown (4 h) kept his land from going wild, so it's
  // still dark: "Light my land" takes the kid there.
  await page.getByTestId('hollow-report-light').tap();
  await expect(report).toBeHidden();
  await page.getByTestId('tile-panel').getByRole('button', { name: 'Close' }).tap();

  // The Hollow button: who's waiting there, and a rescue from right here.
  const open = await trayButton(page, 'hollow-open');
  await expect(open).toContainText('1');
  await open.tap();
  const sheet = page.getByTestId('hollow-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('bring them home');
  // Taken to the Hollow, they're shown greyed (design doc §14).
  await expect(sheet.getByTestId('hollow-token-grey')).toHaveCount(1);
  expect(findAvoidedWords((await sheet.textContent()) ?? '')).toEqual([]);
  await page.getByTestId('hollow-rescue').first().tap();

  // The rescue is a showdown with the Hollow's shadows.
  await expect(page.getByTestId('battle-hud')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('battle-caption')).toContainText('Shadows from the Hollow');
  // The shadow is drawn shadowy (dark lavender, glowing rim); the player's own
  // squishy, out on the other side, looks like itself (owner decision 7).
  await expect
    .poll(async () => (await battleState(page))?.scene, { timeout: 30_000 })
    .toMatchObject({ squishies: 2, shadowLook: 1 });
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
  // Close this player's page so its battle doesn't keep drawing under later tests.
  await page.context().close();
});
