import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { tapTile } from './claim-land.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * The Crafting Factory (#294, owner-approved mockup of 2026-10-08): build it
 * on a homestead (#295, one building a tile), open it from its tile card and
 * start a batch (pick, how many, Max), queue another from the Recipe Book,
 * watch them in the Bag, stop one (what's made stays, the rest comes back),
 * and see the welcome-back card after a while away. Checked through the dev
 * hooks and the server's replies, not pixels.
 */

interface InventoryDebug {
  mapId: string;
  items: Record<string, number>;
  batches: number | null;
  factorySheet: 'list' | 'pick' | 'stop' | null;
  welcome: boolean;
}

const bagState = (page: Page) => hook<InventoryDebug>(page, 'inventory');
const mapState = (page: Page) => hook<{ id: string }>(page, 'map');
const slowExpect = expect.configure({ timeout: 30_000 });

test('builds a Factory on a homestead, runs batches from it, the book and the bag, and welcomes you back', async ({
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
  // A ready homestead next to home (dev route): the Factory goes on one (#295).
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Busy Patch')!.id;
  const made = await api<{ q: number; r: number }>(page, 'POST', `/maps/${mapId}/dev/homestead`);
  expect(made.status).toBe(201);
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 130, stone: 90, treats: 12, greens: 4 },
  });
  expect(granted.status).toBe(201);
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  expect((await mapState(page))!.id).toBe(mapId);

  // Build it on the homestead from the Build sheet: its card says what it does.
  await tapTile(page, made.body);
  await page.getByTestId('tile-build').tap();
  await page.locator('[data-build="crafting-factory"]').tap();
  await expect(page.getByTestId('build-detail')).toContainText('🏭 2 batches at once');
  await page.getByTestId('build-go').tap();
  // Its tile card shows Sprout's tip (once); Open shows its batches.
  const tileCard = page.getByTestId('tile-factory');
  await slowExpect(tileCard).toBeVisible();
  await expect(tileCard.getByTestId('factory-tip')).toContainText('Ooh, a Factory!');
  await tileCard.getByTestId('tile-factory-open').tap();
  const factorySheet = page.getByTestId('factory-sheet');
  await slowExpect(factorySheet).toBeVisible();
  await expect.poll(async () => (await bagState(page))?.batches).toBe(0);

  // Start a batch: pick Heart Charms, Max, then one fewer.
  const panel = factorySheet;
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
  await expect.poll(async () => (await bagState(page))?.batches).toBe(1);
  await factorySheet.getByTestId('factory-close').tap();

  // Upgrading from its tile card (60 Timber, 50 Stone) keeps the batch going
  // and makes room for a third.
  await tileCard.getByTestId('tile-factory-upgrade').tap();
  await page.getByTestId('tile-factory-upgrade-confirm').tap();
  await slowExpect(page.getByTestId('tile-factory')).toContainText('Level 2');
  await page.getByTestId('tile-factory-open').tap();
  await slowExpect(factorySheet.locator('.factory-about')).toHaveText(
    'Room for 3 batches at once.',
  );
  await expect(charms).toBeVisible();
  await expect(factorySheet.getByTestId('factory-start-batch')).toBeVisible();
  await factorySheet.getByTestId('factory-close').tap();

  // The Recipe Book queues Cooked Treats from its page.
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
