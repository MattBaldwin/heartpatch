import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The starter pick (owner decision 2026-10-03): the first visit to a new
 * patch asks "Choose your friend!" with three starters, before the map; the
 * pick is granted once. Checked through the dev hook and the API, never pixels.
 */

interface StarterDebug {
  mapId: string | null;
  picked: string | null;
  shown: string[];
  hopping: boolean;
}

const starterState = (page: Page) => hook<StarterDebug>(page, 'starter');

test('a new patch asks for a starter once, before the map', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('pick'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Friendly Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();

  // The picker owns the screen: three starters in 3D, nothing picked yet.
  const picker = page.getByTestId('starter-picker');
  await expect(picker.getByRole('heading', { name: 'Choose your friend!' })).toBeVisible();
  await expect(lobby).toBeHidden();
  await expect(page.getByTestId('lobby-open')).toBeHidden();
  await expect
    .poll(() => starterState(page).then((s) => s?.shown), { timeout: 30_000 })
    .toEqual(['emberbun', 'puddlepuff', 'thistlepip']);
  const choose = picker.getByRole('button', { name: 'Choose', exact: true });
  await expect(choose).toBeDisabled();

  // Tap one to meet it (it hops), change your mind, then choose.
  await picker.getByRole('button', { name: /^Emberbun, Fire and Cozy/ }).tap();
  await expect.poll(() => starterState(page).then((s) => s?.picked)).toBe('emberbun');
  await expect(picker).toContainText('Warm as a fresh bun');
  await picker.getByRole('button', { name: /^Thistlepip, Leaf and Brave/ }).tap();
  await expect(picker.getByRole('button', { name: /^Thistlepip/ }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: 'Choose Thistlepip' }).tap();

  // Then the map, with the new friend at home.
  await expect(picker).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('map-hud')).toContainText('Friendly Patch');
  const mapId = (await hook<{ id: string }>(page, 'map'))?.id ?? null;
  expect(mapId).not.toBeNull();
  const detail = await api(page, 'GET', `/maps/${mapId!}`);
  expect(detail.body).toMatchObject({ map: { needsStarter: false } });

  // Visiting again goes straight to the map.
  await page.getByTestId('lobby-open').tap();
  await lobby.getByRole('button', { name: /Friendly Patch/ }).tap();
  await visitPatch(lobby);
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Friendly Patch');

  expect(errors).toEqual([]);
});

test('a pick or map that fails never leaves the screen blank', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('oops'));
  const lobby = page.getByTestId('lobby');
  const picker = page.getByTestId('starter-picker');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Wobbly Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();

  // Removed from the patch meanwhile: the pick is NOT_FOUND, and the lobby
  // comes back with the message instead of a picker that can't go anywhere.
  await page.route('**/api/v1/maps/*/starter', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_FOUND', message: "We couldn't find that patch." },
      }),
    }),
  );
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await picker.getByRole('button', { name: /^Puddlepuff,/ }).tap();
  await picker.getByRole('button', { name: 'Choose Puddlepuff' }).tap();
  await expect(picker).toBeHidden();
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  await expect(lobby.getByTestId('lobby-notice')).toHaveText("We couldn't find that patch.");
  await page.unroute('**/api/v1/maps/*/starter');

  // The pick works but the map can't load: back to the lobby with a message.
  await page.route('**/api/v1/maps/*/view', (route) => route.abort());
  await lobby.getByRole('button', { name: /Wobbly Patch/ }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await picker.getByRole('button', { name: /^Puddlepuff,/ }).tap();
  await picker.getByRole('button', { name: 'Choose Puddlepuff' }).tap();
  await expect(picker).toBeHidden({ timeout: 30_000 });
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  await expect(lobby.getByTestId('lobby-notice')).not.toBeEmpty();
  await page.unroute('**/api/v1/maps/*/view');

  // Picked for real, so the next visit goes straight to the map.
  await lobby.getByRole('button', { name: /Wobbly Patch/ }).tap();
  await visitPatch(lobby);
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Wobbly Patch');
});
