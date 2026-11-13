import { expect, test, type Page } from '@playwright/test';
import { api, hook, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

// My Home's dots (#731c): a full gatherer dots the Jobs row, from what the
// server's jobs view says, and opening the board (which banks its work) clears it.

interface HomeAlert {
  count: number;
  peek: string;
}
const alerts = (page: Page) =>
  hook<{ home: HomeAlert | null; jobs: HomeAlert | null }>(page, 'homeAlerts');
const mapState = (page: Page) => hook<{ id: string }>(page, 'map');
const jobsState = (page: Page) =>
  hook<{ board: { jobs: Record<string, string> } }>(page, 'jobs');

test('My Home dots the Jobs row while a gatherer is full', async ({ browser }) => {
  test.setTimeout(240_000); // two map builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('dots'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Dotty Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await waitForLiveMap(page);
  const mapId = (await mapState(page))!.id;

  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'mossmuffin',
    level: 4,
  });
  expect(granted.status).toBe(201);
  const helperId = (granted.body as { squishy: { id: string } }).squishy.id;

  // Off to gather, from the job board.
  await (await trayButton(page, 'jobs-open')).tap();
  const board = page.getByTestId('jobs');
  const helper = board.locator(`[data-testid="jobs-row"][data-squishy="${helperId}"]`);
  await helper.getByRole('button', { name: /Gather/ }).tap();
  await helper.getByTestId('jobs-picker').getByTestId('jobs-spot').first().tap();
  await expect.poll(async () => (await jobsState(page))?.board.jobs[helperId]).toBe('gatherer');
  await board.getByRole('button', { name: 'Close' }).tap();
  await expect(board).toBeHidden();
  // Working, not full: no dot.
  expect((await alerts(page))?.jobs ?? null).toBeNull();

  // Its store fills (maxStoredCycles cycles, the dev short timer)...
  for (let i = 0; i < 4; i++) {
    expect((await api(page, 'POST', `/maps/${mapId}/dev/work/ready`)).status).toBe(200);
  }
  // ...and the map, opened again, reads the jobs view that says so.
  await page.reload();
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await waitForLiveMap(page, mapId);
  await expect
    .poll(async () => (await alerts(page))?.jobs ?? null, { timeout: 30_000 })
    .toEqual({ count: 1, peek: 'A gatherer is full' });
  const jobsRow = await trayButton(page, 'jobs-open');
  const dot = jobsRow.locator('.home-alert-badge');
  await expect(dot).toBeVisible();
  await expect(dot).toHaveText('1');
  await expect(dot).toHaveAttribute('data-tray-alert', 'A gatherer is full');

  // Opening the board banks the work: the gatherer works on and the dot goes.
  await jobsRow.tap();
  await expect(page.getByTestId('landed-toast')).toContainText('+');
  await expect.poll(async () => (await alerts(page))?.jobs ?? null).toBeNull();
  await board.getByRole('button', { name: 'Close' }).tap();
  await expect(dot).toBeHidden();
  expect(errors).toEqual([]);
});
