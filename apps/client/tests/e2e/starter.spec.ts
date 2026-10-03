import { expect, test, type Page } from '@playwright/test';
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

type Hook = { __heartpatch?: { starter?(): StarterDebug | null } };

const starterState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.starter?.() ?? null);

/** `GET /api/v1/<path>` with the player's cookie: status and JSON body. */
const apiGet = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const res = await fetch(`/api/v1${p}`, { headers: { 'x-requested-with': 'heartpatch' } });
    return { status: res.status, body: (await res.json()) as unknown };
  }, path);

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
  const mapId = await page.evaluate(
    () =>
      (
        window as unknown as { __heartpatch?: { map?(): { id: string } | null } }
      ).__heartpatch?.map?.()?.id ?? null,
  );
  expect(mapId).not.toBeNull();
  const detail = await apiGet(page, `/maps/${mapId!}`);
  expect(detail.body).toMatchObject({ map: { needsStarter: false } });

  // Visiting again goes straight to the map.
  await page.getByTestId('lobby-open').tap();
  await lobby.getByRole('button', { name: /Friendly Patch/ }).tap();
  await visitPatch(lobby);
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Friendly Patch');

  expect(errors).toEqual([]);
});
