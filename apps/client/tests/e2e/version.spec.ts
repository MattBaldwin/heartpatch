import { expect, test } from '@playwright/test';
import { newPlayer, uniqueName, visitPatch } from './players.js';

// The game's version in the profile menu (#198). The line is baked in at
// build time (vite.config.ts `define`), so this dev server shows the same
// `v0.<commits> · <sha> · <date>` a CI or deploy build does. A waiting service
// worker's "Update now" is covered by app-updates.test.ts (Playwright can't
// hand WebKit a new sw.js); a newer server takes the same row here.

const VERSION = /^v0\.\d+ · [0-9a-f]{7} · \d{4}-\d{2}-\d{2}$/;

test('the profile menu shows the version, and Update now when the server is newer', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('ver'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Version Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  const menu = page.getByTestId('keeper-menu');
  const line = page.getByTestId('app-version');
  const updateNow = page.getByTestId('app-update-now');
  await menu.tap();
  await expect(line).toBeVisible();
  await expect(line).toHaveText(VERSION);
  await expect(updateNow).toBeHidden();
  const version = (await line.textContent()) ?? '';
  const build = Number(/^v0\.(\d+)/.exec(version)?.[1]);
  await menu.tap();

  // The server says it's a later build than this app.
  await page.route('**/api/v1/health', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, build: build + 1, commit: 'fffffff' } });
  });
  await menu.tap();
  await expect(line).toHaveText(`${version} · update ready`);
  await expect(updateNow).toBeVisible();

  // Tapping it reloads into the new version.
  await page.evaluate(() => {
    (window as { beforeUpdate?: boolean }).beforeUpdate = true;
  });
  await Promise.all([page.waitForEvent('load'), updateNow.tap()]);
  expect(await page.evaluate(() => (window as { beforeUpdate?: boolean }).beforeUpdate)).toBe(
    undefined,
  );
  await page.context().close();
});
