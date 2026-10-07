import { findAvoidedWords, STARTERS } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { claimLand } from './claim-land.js';
import { api, hook, idle } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * The Hollow Man on an iPhone (issue #21): home is always safe (the Heart
 * Seed, #202), so a new player claims land and posts a guard out there;
 * with no fire lit on it they get a nudge to light one, and two nights of
 * grace (owner decision 2026-10-03). Then night falls (the dev route), he
 * visits the map once, takes the guard standing in the dark to the Hollow,
 * the morning report says so kindly, and a rescue sets off from anywhere.
 * Checked through the dev hook's signals, never pixels or timing.
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
}

const hollowState = (page: Page) => hook<HollowDebug>(page, 'hollow');
const mapState = (page: Page) => hook<{ id: string; live: string | null }>(page, 'map');
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
  page.on('pageerror', (err) => errors.push(err.message));
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
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  if (!(await hollowState(page))!.night) {
    // The reload shut the trays: open the one the nudge lives in again.
    await trayButton(page, 'hollow-fire-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('A friend sleeps out in the dark. Light a fire there!');
    expect(findAvoidedWords((await hint.textContent()) ?? '')).toEqual([]);
  }

  // First-night grace: the first two nightfalls take nothing.
  for (let night = 0; night < 2; night++) {
    const graced = await api(page, 'POST', `/maps/${mapId}/dev/nightfall`);
    expect(graced).toMatchObject({ status: 200, body: { taken: 0 } });
  }
  // He still comes by (the live visit), then fades; wait for that before counting.
  await expect
    .poll(async () => (await hollowState(page))?.visits ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await hollowState(page))?.visiting, { timeout: 30_000 })
    .toBe(false);
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
  const visitsBefore = (await hollowState(page))!.visits;
  // The quiet nights still teach (#134): the squishy was out in the dark and
  // he let it be, so the morning report says so and asks for a fire.
  const graceReport = page.getByTestId('hollow-report');
  await expect(graceReport).toBeVisible();
  await expect(graceReport).toContainText('took nobody this time');
  await expect(graceReport).toContainText('A friend sleeps out in the dark. Light a fire there!');
  expect(findAvoidedWords((await graceReport.textContent()) ?? '')).toEqual([]);
  expect(await hollowState(page)).toMatchObject({ hollowed: 0 });
  await page.getByTestId('hollow-report-ok').tap();
  await expect(graceReport).toBeHidden();
  expect(await hollowState(page)).toMatchObject({ hollowed: 0, report: [] });
  // The raid report (#16) is open when night falls: the Hollow's report waits its turn.
  await (await trayButton(page, 'raid-open')).tap();
  const raidSheet = page.getByTestId('raid-report');
  await expect(raidSheet).toBeVisible();
  const fell = await api(page, 'POST', `/maps/${mapId}/dev/nightfall`);
  expect(fell).toMatchObject({ status: 200, body: { taken: 1 } });

  // He visits once, live, and the map stops drawing when he's gone.
  await expect.poll(async () => (await hollowState(page))?.visits).toBe(visitsBefore + 1);
  await expect
    .poll(async () => (await hollowState(page))?.visiting, { timeout: 30_000 })
    .toBe(false);
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);

  // One morning report at a time: the Hollow's shows once the raid report closes.
  const report = page.getByTestId('hollow-report');
  await expect(report).toBeHidden();
  await raidSheet.getByTestId('raid-done').tap();
  await expect(raidSheet).toBeHidden();
  // The morning report: gentle, and always "you can rescue them".
  await expect(report).toBeVisible();
  await expect(report).toContainText('The Hollow Man visited last night');
  await expect(report).toContainText('You can rescue them!');
  expect(findAvoidedWords((await report.textContent()) ?? '')).toEqual([]);
  expect(await hollowState(page)).toMatchObject({ hollowed: 1, report: [expect.any(String)] });
  await page.getByTestId('hollow-report-ok').tap();
  await expect(report).toBeHidden();

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
