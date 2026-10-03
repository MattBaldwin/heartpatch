import { findAvoidedWords, STARTERS } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The Hollow Man on an iPhone (issue #21): a new player gets a nudge to light
 * a fire and two nights of grace (owner decision 2026-10-03); then night falls
 * (the dev route), he visits the map once, takes a squishy left outside a lit
 * fire to the Hollow, the morning report says so kindly, and a rescue sets off
 * from anywhere.
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

type Hook = {
  __heartpatch?: {
    hollow?(): HollowDebug | null;
    map?(): { id: string; live: string | null } | null;
    idle(): boolean;
    battle?(): { status: string; scene: { squishies: number; shadowLook: number } | null } | null;
  };
};

const hollowState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.hollow?.() ?? null);
const mapState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.() ?? null);
const battleState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.battle?.() ?? null);
const isIdle = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.idle() ?? false);

/** A dev/test route on the open map, from the page (its session cookie). */
const devPost = (page: Page, path: string, body?: object) =>
  page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method: 'POST',
        headers: {
          'x-requested-with': 'heartpatch',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: (await res.json()) as unknown };
    },
    { path, body },
  );

test('night falls, the Hollow Man visits, and a rescue sets off', async ({ browser }) => {
  test.setTimeout(180_000); // map and arena builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('hollow'));
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

  // New here with no fire: a small nudge (unless it's night on the server's clock).
  const hint = page.getByTestId('hollow-fire-hint');
  if (!(await hollowState(page))!.night) {
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Light a fire before night falls!');
    expect(findAvoidedWords((await hint.textContent()) ?? '')).toEqual([]);
  }

  // One squishy, waiting by the Heart Seed with no Hearthfire built: exposed.
  const squishy = { speciesId: STARTERS.speciesIds[0], level: 5 };
  expect((await devPost(page, `/maps/${mapId}/dev/squishies`, squishy)).status).toBe(201);
  // First-night grace: the first two nightfalls take nothing.
  for (let night = 0; night < 2; night++) {
    const graced = await devPost(page, `/maps/${mapId}/dev/nightfall`);
    expect(graced).toMatchObject({ status: 200, body: { taken: 0 } });
  }
  // He still comes by (the live visit), then fades; wait for that before counting.
  await expect
    .poll(async () => (await hollowState(page))?.visits ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await hollowState(page))?.visiting, { timeout: 30_000 })
    .toBe(false);
  await expect.poll(() => isIdle(page), { timeout: 30_000 }).toBe(true);
  const visitsBefore = (await hollowState(page))!.visits;
  expect(await hollowState(page)).toMatchObject({ hollowed: 0, report: [] });
  // The raid report (#16) is open when night falls: the Hollow's report waits its turn.
  await page.getByTestId('raid-open').tap();
  const raidSheet = page.getByTestId('raid-report');
  await expect(raidSheet).toBeVisible();
  const fell = await devPost(page, `/maps/${mapId}/dev/nightfall`);
  expect(fell).toMatchObject({ status: 200, body: { taken: 1 } });

  // He visits once, live, and the map stops drawing when he's gone.
  await expect.poll(async () => (await hollowState(page))?.visits).toBe(visitsBefore + 1);
  await expect
    .poll(async () => (await hollowState(page))?.visiting, { timeout: 30_000 })
    .toBe(false);
  await expect.poll(() => isIdle(page), { timeout: 30_000 }).toBe(true);

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
  const open = page.getByTestId('hollow-open');
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
