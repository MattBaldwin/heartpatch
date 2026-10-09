import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * The Crafting Factory (#294, owner-approved mockup of 2026-10-08): build it
 * at home, start a batch from its card (pick, how many, Max), queue another
 * from the Recipe Book, watch them in the Bag, stop one (what's made stays,
 * the rest comes back), and see the welcome-back card after a while away.
 * Checked through the dev hooks and the server's replies, not pixels.
 */

interface InventoryDebug {
  mapId: string;
  items: Record<string, number>;
  batches: number | null;
  factorySheet: 'list' | 'pick' | 'stop' | null;
  welcome: boolean;
}

interface HomeDebug {
  mode: string;
  factoryBatches: number | null;
  factoryPanel: 'list' | 'pick' | 'stop' | null;
}

const bagState = (page: Page) => hook<InventoryDebug>(page, 'inventory');
const homeState = (page: Page) => hook<HomeDebug>(page, 'home');
const mapState = (page: Page) => hook<{ id: string }>(page, 'map');
const slowExpect = expect.configure({ timeout: 30_000 });

test('builds a Factory, runs batches from home, the book and the bag, and welcomes you back', async ({
  browser,
}) => {
  test.setTimeout(180_000); // two scene builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('factory'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Busy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const mapId = (await mapState(page))!.id;
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 130, stone: 90, treats: 12, greens: 4 },
  });
  expect(granted.status).toBe(201);

  // Build it at home: its row says what it does.
  await (await trayButton(page, 'home-open')).tap();
  const sheet = page.getByTestId('home');
  await slowExpect(sheet).toBeVisible();
  await sheet.getByTestId('home-build').tap();
  const row = sheet.locator('[data-build-row="crafting-factory"]');
  await expect(row.locator('.home-effect')).toHaveText(['🏭 2 batches at once']);
  await row.locator('[data-build="crafting-factory"]').tap();
  await sheet.getByTestId('home-anywhere').tap();
  // Its card opens with Sprout's tip (once) and the queue panel.
  const panel = sheet.getByTestId('factory-panel');
  await slowExpect(panel).toBeVisible();
  await expect(sheet.getByTestId('factory-tip')).toContainText('Ooh, a Factory!');
  await expect.poll(async () => (await homeState(page))?.factoryBatches).toBe(0);

  // Start a batch: pick Heart Charms, Max, then one fewer.
  await panel.getByTestId('factory-start-batch').tap();
  await panel.locator('[data-testid="factory-pick"][data-recipe="heart-charm"]').tap();
  // 12 Treats pay for 12 Heart Charms (Timber is plenty).
  await panel.getByTestId('factory-max').tap();
  await expect(panel.getByTestId('factory-n')).toHaveText('12');
  await panel.getByTestId('factory-minus').tap();
  await expect(panel.getByTestId('factory-plan')).toHaveText(
    'Uses 22 🪵 · 11 🍪 now · all done in 11 min',
  );
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);
  await panel.getByTestId('factory-start').tap();
  const charms = panel.locator('[data-testid="factory-batch"][data-recipe="heart-charm"]');
  await slowExpect(charms).toBeVisible();
  await expect(charms.getByTestId('factory-count')).toHaveText('0/11');
  await expect.poll(async () => (await homeState(page))?.factoryBatches).toBe(1);

  // Upgrading (60 Timber, 50 Stone) keeps the batch going and makes room for a third.
  await sheet.getByTestId('home-upgrade').tap();
  await sheet.getByTestId('home-upgrade-confirm').tap();
  await slowExpect(panel.locator('.factory-about')).toHaveText('Room for 3 batches at once.');
  await expect(charms).toBeVisible();
  await expect(panel.getByTestId('factory-start-batch')).toBeVisible();

  // Back to the map: the Recipe Book queues Cooked Treats from its page.
  await sheet.getByTestId('home-done').tap();
  await sheet.getByTestId('home-back').tap();
  await expect.poll(async () => (await bagState(page))?.batches, { timeout: 30_000 }).toBe(1);
  await (await trayButton(page, 'recipe-book-open')).tap();
  const book = page.getByTestId('recipe-book');
  await expect(book).toBeVisible();
  const later = page.getByTestId('recipe-book-new-page').getByRole('button', { name: 'Later' });
  while (await later.isVisible().catch(() => false)) await later.tap();
  await page.getByTestId('recipe-book-cover-open').tap();
  await book.locator('[data-testid="recipe-book-toc"][data-page="recipe:cook-treats"]').tap();
  const treatsPage = book.locator('article[data-page="recipe:cook-treats"]');
  await treatsPage.getByTestId('recipe-book-queue').tap();
  await expect(treatsPage.getByTestId('factory-n')).toHaveText('2');
  await treatsPage.getByTestId('factory-start').tap();
  await expect.poll(async () => (await bagState(page))?.batches).toBe(2);
  await expect(page.getByTestId('recipe-book-say')).toContainText('Off it goes!');
  await expect(book.getByTestId('factory-strip')).toContainText('2 of 3 going');
  await page.getByTestId('recipe-book-close').tap();

  // The Bag: the strip, and Stop on the charms (made ones stay, the rest come back).
  await (await trayButton(page, 'bag-open')).tap();
  const bag = page.getByTestId('bag');
  await expect(bag.getByTestId('factory-strip')).toBeVisible();
  await bag.getByTestId('factory-strip').tap();
  const factorySheet = page.getByTestId('factory-sheet');
  await expect(factorySheet).toBeVisible();
  const before = (await bagState(page))!.items;
  await factorySheet
    .locator('[data-testid="factory-batch"][data-recipe="heart-charm"]')
    .getByTestId('factory-stop')
    .tap();
  await expect(factorySheet.getByTestId('factory-stop-lines')).toContainText('You get back');
  await factorySheet.getByTestId('factory-stop-confirm').tap();
  await expect.poll(async () => (await bagState(page))?.batches).toBe(1);
  const after = (await bagState(page))!.items;
  expect(after['treats'] ?? 0).toBeGreaterThan(before['treats'] ?? 0);
  await factorySheet.getByTestId('factory-close').tap();
  await bag.getByRole('button', { name: 'Close' }).tap();

  // Away for an hour (the device remembers when it last saw the patch), the
  // Treats finish, and coming back shows what the Factory made.
  const userId = await page.evaluate(
    () =>
      Object.keys(localStorage)
        .find((k) => k.startsWith('heartpatch.factory.seen.'))
        ?.split('.')[3],
  );
  expect(userId).toBeTruthy();
  await page.evaluate(
    ({ key }) => {
      localStorage.setItem(key, String(Date.now() - 60 * 60 * 1000));
    },
    { key: `heartpatch.factory.seen.${userId!}.${mapId}` },
  );
  expect((await api(page, 'POST', `/maps/${mapId}/dev/factory/ready`)).status).toBe(200);
  // The app comes back to the front: the patch settles, measuring time away.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const welcome = page.getByTestId('factory-welcome');
  await slowExpect(welcome).toBeVisible();
  await expect(welcome.getByTestId('factory-welcome-got')).toContainText('🍪 +6 Treats');
  expect(findAvoidedWords((await welcome.textContent()) ?? '')).toEqual([]);
  await welcome.getByTestId('factory-welcome-ok').tap();
  await expect(welcome).toBeHidden();
  await expect.poll(async () => (await bagState(page))?.batches).toBe(0);

  expect(errors).toEqual([]);
});
