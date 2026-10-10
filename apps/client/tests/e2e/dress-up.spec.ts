import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

/**
 * Dress up (#340): a player who owns a squishy accessory opens their squishy
 * up close, taps Dress up, puts the piece on and sees it drawn on the
 * squishy; it's still on next time (the server kept it), and Nothing takes
 * it off. Checks are on game state (the close-up's dev hook and the API),
 * never pixels.
 */

interface CloseUpDebug {
  squishyId: string;
  phase: 'arriving' | 'here' | 'leaving';
  dressing: boolean;
  accessory: string | null;
}

const state = (page: Page) => hook<CloseUpDebug>(page, 'closeUp');
const homeOpen = async (page: Page) => (await hook<{ open: boolean }>(page, 'home'))?.open ?? false;
const mapId = async (page: Page) => (await hook<{ id: string }>(page, 'map'))?.id ?? null;

async function openFromHome(page: Page): Promise<void> {
  await (await trayButton(page, 'home-open')).tap();
  await expect.poll(() => homeOpen(page), slow).toBe(true);
  await page.getByTestId('home-friends').locator('[data-care-squishy]').first().tap();
  await slowExpect(page.getByTestId('care')).toBeVisible();
  await page.getByTestId('care-close-up').tap();
  await expect.poll(async () => (await state(page))?.phase, slow).toBe('here');
}

/** What the server says the squishy wears, from the care read (#340). */
async function worn(page: Page, map: string, id: string): Promise<string | null | undefined> {
  const res = await api<{ squishies: { id: string; accessory?: string | null }[] }>(
    page,
    'GET',
    `/maps/${map}/care`,
  );
  return res.body.squishies.find((s) => s.id === id)?.accessory;
}

test('puts an accessory on a squishy up close and sees it on them', async ({ browser }) => {
  test.setTimeout(240_000); // two scene builds plus the starter screen; CI renders in software
  const page = await newPlayer(browser, uniqueName('dress'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Dress Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  // A Boutique piece, as if bought (the starter Tiny Bow everyone owns too).
  expect((await api(page, 'POST', '/dev/wardrobe/items', { items: ['tiny-crown'] })).status).toBe(
    201,
  );
  const map = (await mapId(page))!;

  await openFromHome(page);
  const id = (await state(page))!.squishyId;
  expect((await state(page))?.accessory).toBeNull();

  const card = page.getByTestId('close-up');
  await card.getByTestId('close-up-dress-open').tap();
  await expect.poll(async () => (await state(page))?.dressing).toBe(true);
  const list = page.getByTestId('close-up-dress-list');
  // Nothing first, then what I own, in catalog order; never Keeper clothing.
  await slowExpect(list.locator('[data-accessory]')).toHaveCount(3);
  await expect(list.locator('[data-accessory]').first()).toHaveAttribute('data-accessory', 'none');
  await expect(list.locator('[data-accessory="none"]')).toHaveAttribute('aria-pressed', 'true');

  await list.locator('[data-accessory="tiny-crown"]').tap();
  // On the squishy at once, and the server keeps it.
  await expect.poll(async () => (await state(page))?.accessory).toBe('tiny-crown');
  await slowExpect(page.getByTestId('close-up-dress-status')).toContainText(
    'loves the Tiny Crown!',
  );
  await expect(list.locator('[data-accessory="tiny-crown"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(() => worn(page, map, id), slow).toBe('tiny-crown');

  // Swap it, then Done brings the care buttons back.
  await list.locator('[data-accessory="tiny-bow"]').tap();
  await expect.poll(async () => (await state(page))?.accessory).toBe('tiny-bow');
  await expect.poll(() => worn(page, map, id), slow).toBe('tiny-bow');
  await page.getByTestId('close-up-dress-done').tap();
  await expect.poll(async () => (await state(page))?.dressing).toBe(false);
  await expect(card.locator('[data-care="pet"]')).toBeVisible();

  // Next time up close, it's still wearing it.
  await card.getByTestId('close-up-back').tap();
  await expect.poll(() => state(page), slow).toBeNull();
  await expect.poll(() => homeOpen(page), slow).toBe(true);
  await page.getByTestId('home-friends').locator('[data-care-squishy]').first().tap();
  await page.getByTestId('care-close-up').tap();
  await expect.poll(async () => (await state(page))?.phase, slow).toBe('here');
  expect((await state(page))?.accessory).toBe('tiny-bow');

  // Nothing takes it off.
  await card.getByTestId('close-up-dress-open').tap();
  await list.locator('[data-accessory="none"]').tap();
  await expect.poll(async () => (await state(page))?.accessory).toBeNull();
  await expect.poll(() => worn(page, map, id), slow).toBeNull();
  expect(errors).toEqual([]);
});
