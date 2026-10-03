import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Patch Coins and the Boutique (#45): earn a coin by caring for the starter,
 * see it on the patch list, then try a piece on and buy it from the Wardrobe.
 * Checked through the dev hook's state, never pixels.
 */

const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

interface BoutiqueDebug {
  open: boolean;
  loaded: boolean;
  balance: number | null;
  daily: string[];
  owned: string[];
  previewing: string | null;
  sheet: { kind: 'confirm' | 'short'; itemId: string } | null;
  buying: boolean;
}

type Hook = {
  __heartpatch?: {
    wardrobe?(): { owned: string[]; trying: string[]; boutique: BoutiqueDebug } | null;
  };
};

const wardrobeState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.wardrobe?.() ?? null);
const shopState = async (page: Page) => (await wardrobeState(page))?.boutique ?? null;

test('earns Patch Coins from care, then buys a piece in the Boutique', async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await newPlayer(browser, uniqueName('shop'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await slowExpect(lobby.getByTestId('lobby-coins')).toHaveText('0');

  // Earn: pet the starter once (a full care action pays a coin).
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Coin Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await page.getByTestId('home-open').tap();
  await page.getByTestId('home-friends').locator('[data-care-squishy]').first().tap();
  const care = page.getByTestId('care');
  await slowExpect(care).toBeVisible();
  await care.locator('[data-care="pet"]').tap();
  await slowExpect(page.getByTestId('care-note')).toContainText('So soft!');
  await care.getByTestId('care-close').tap();
  await page.getByTestId('home-back').tap();
  await page.getByTestId('lobby-open').tap();
  await slowExpect(lobby.getByTestId('lobby-coins')).toHaveText('1');

  // The Boutique, from the Wardrobe: one coin isn't enough for anything yet.
  await lobby.getByTestId('wardrobe-open').tap();
  await page.getByTestId('wardrobe-boutique').tap();
  const shop = page.getByTestId('boutique');
  await slowExpect(shop).toBeVisible();
  await expect.poll(async () => (await shopState(page))?.loaded, slow).toBe(true);
  const first = (await shopState(page))!;
  expect(first).toMatchObject({ open: true, balance: 1, owned: [] });
  const itemId = first.daily[0]!;
  await shop.locator(`[data-item="${itemId}"]`).tap();
  // The Keeper tries it on, and the sheet says kindly it's not affordable yet.
  await expect.poll(async () => (await shopState(page))?.previewing).toBe(itemId);
  await slowExpect(page.getByTestId('boutique-sheet')).toContainText('Not enough Patch Coins yet!');
  await page.getByTestId('boutique-okay').tap();
  await slowExpect(page.getByTestId('boutique-sheet')).toBeHidden();

  // A top-up (dev builds only), then buy it for real.
  const res = await page.request.post('/api/v1/dev/coins', {
    data: { amount: 200 },
    headers: { 'x-requested-with': 'heartpatch' },
  });
  expect(res.status()).toBe(201);
  await page.getByTestId('boutique-back').tap();
  await page.getByTestId('wardrobe-boutique').tap();
  await expect.poll(async () => (await shopState(page))?.balance, slow).toBe(201);
  await shop.locator(`[data-item="${itemId}"]`).tap();
  await slowExpect(page.getByTestId('boutique-sheet')).toContainText('Patch Coins?');
  await page.getByTestId('boutique-buy').tap();
  await expect.poll(async () => (await shopState(page))?.owned, slow).toEqual([itemId]);
  await slowExpect(page.getByTestId('boutique-note')).toContainText('is in your wardrobe');
  const after = (await shopState(page))!;
  expect(after.balance).toBeLessThan(201);
  expect(after.sheet).toBeNull();
  expect((await wardrobeState(page))!.owned).toContain(itemId);
  await slowExpect(page.getByTestId('boutique-coins')).toHaveText(String(after.balance));

  // Back in the wardrobe, it's there to wear.
  await page.getByTestId('boutique-back').tap();
  await slowExpect(page.getByTestId('wardrobe-items')).toBeVisible();
  expect(errors).toEqual([]);
});
