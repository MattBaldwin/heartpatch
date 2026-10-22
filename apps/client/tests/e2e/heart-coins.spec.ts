import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { careFromRoster, closeRoster } from './roster.js';
import { trayButton } from './trays.js';

/**
 * Heart Coins on screen (#601): the 💛 pill on the map's name card and on
 * Home's peek bar, the sheet it opens, a real Heart Coin from care, and the
 * patch list's line. Checked through the dev hook and test ids, not pixels.
 */

const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

interface HeartCoinsDebug {
  mapId: string | null;
  balance: number | null;
  open: boolean;
  page: { balance: number; rows: { source: string; value: string }[]; resets: string } | null;
}

const heartState = (page: Page) => hook<HeartCoinsDebug>(page, 'heartCoins');

test('shows Heart Coins on the map, at home and on the patch list, and care pays one', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const page = await newPlayer(browser, uniqueName('heart'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Heart Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();

  // The map's name card: a new patch starts at 0.
  const mapPill = page.locator('[data-testid="heart-coins"][data-where="map"]');
  await slowExpect(mapPill).toBeVisible();
  await expect(mapPill).toHaveText('💛0');
  await expect(mapPill).toHaveAccessibleName(/0 Heart Coins/);
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;

  // A top-up (dev builds only); the sheet reads it fresh when it opens.
  const res = await page.request.post(`/api/v1/maps/${mapId}/dev/heart-coins`, {
    data: { amount: 12 },
    headers: { 'x-requested-with': 'heartpatch' },
  });
  expect(res.status()).toBe(201);
  await mapPill.tap();
  const sheet = page.getByTestId('heart-coins-sheet');
  await slowExpect(sheet).toBeVisible();
  await expect.poll(async () => (await heartState(page))?.page?.balance, slow).toBe(12);
  await expect(page.getByTestId('heart-coins-balance')).toHaveText('💛12');
  await expect(mapPill).toHaveText('💛12');
  // Today's bars: battles, new friends and land, caring, selling; none earned yet.
  await expect(sheet.getByTestId('heart-coins-row')).toHaveCount(4);
  expect((await heartState(page))!.page!.rows).toEqual([
    expect.objectContaining({ source: 'battle', value: '0 / 20' }),
    expect.objectContaining({ source: 'capture', value: '0 / 15' }),
    expect.objectContaining({ source: 'care', value: '0 / 10' }),
    expect.objectContaining({ source: 'sell', value: '0 / 30' }),
  ]);
  await expect(page.getByTestId('heart-coins-resets')).toHaveText(/^More to earn in \d/);
  // How they differ from Patch Coins, in kid words.
  await expect(page.getByTestId('heart-coins-compare')).toContainText('stay on this patch');
  await expect(page.getByTestId('heart-coins-compare')).toContainText('Patch Coins go everywhere');
  // The whole sheet fits the screen; Close is in reach.
  await expect(page.getByTestId('heart-coins-close')).toBeInViewport();
  await page.getByTestId('heart-coins-close').tap();
  await slowExpect(sheet).toBeHidden();

  // Home's peek bar has its own pill, which opens the same sheet.
  await (await trayButton(page, 'home-open')).tap();
  const homePill = page.locator('[data-testid="heart-coins"][data-where="home"]');
  await slowExpect(homePill).toBeVisible();
  await expect(homePill).toHaveText('💛12');
  // It shares the handle's row (#381), beside the handle, never over its grip,
  // down to a 320pt phone.
  const handle = page.getByTestId('home-handle');
  const besideHandle = async () => {
    const pill = (await homePill.boundingBox())!;
    const grip = (await handle.boundingBox())!;
    expect(pill.x + pill.width).toBeLessThanOrEqual(grip.x + 0.5);
    expect(pill.x).toBeGreaterThanOrEqual(0);
    expect(Math.abs(pill.y + pill.height / 2 - (grip.y + grip.height / 2))).toBeLessThan(4);
  };
  await besideHandle();
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 568 });
  await besideHandle();
  await page.setViewportSize(size);

  // Care pays a Heart Coin here (a full-value pet), and the pill follows.
  const care = await careFromRoster(page);
  await care.locator('[data-care="pet"]').tap();
  await slowExpect(page.getByTestId('care-note')).toContainText('So soft!');
  await care.getByTestId('care-close').tap();
  await closeRoster(page);
  await slowExpect(homePill).toHaveText('💛13');
  await homePill.tap();
  await slowExpect(sheet).toBeVisible();
  await expect
    .poll(async () => (await heartState(page))?.page?.rows.find((r) => r.source === 'care'), slow)
    .toMatchObject({ value: '1 / 10' });
  await page.getByTestId('heart-coins-close-top').tap();
  await slowExpect(sheet).toBeHidden();
  // The opened sheet has no pill: it's the peek bar's.
  await page.getByTestId('home-handle').click();
  await expect(homePill).toBeHidden();
  await page.getByTestId('home-handle').click();
  await expect(homePill).toBeVisible();

  // The patch list: each patch's card says its own Heart Coins.
  await page.getByTestId('home-back').tap();
  await slowExpect(mapPill).toHaveText('💛13');
  await page.getByTestId('lobby-open').tap();
  await slowExpect(lobby.getByTestId('lobby-heart-coins')).toHaveText('💛 13');
  expect(errors).toEqual([]);
});
