import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { openTray, traysState, trayButton } from './trays.js';

// The side trays and the Keeper's Recipe Book (owner decisions 2026-10-04
// and 2026-10-05): open a tray, read the book, make a Heart Charm through the
// server, a sealed page stays sealed, search, and Find on map.

interface RecipeBookDebug {
  open: boolean;
  showing: string[];
  unlocked: string[];
  fresh: string[];
  canMakeOnly: boolean;
  searching: boolean;
}

const bookState = (page: Page) => hook<RecipeBookDebug>(page, 'recipeBook');
const bagState = (page: Page) =>
  hook<{ mapId: string; items: Record<string, number>; crafts: number }>(page, 'inventory');
const mapState = (page: Page) => hook<{ id: string; selected: string | null }>(page, 'map');

test('trays hold the controls, and the recipe book makes, seals, searches and finds', async ({
  browser,
}) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const page = await newPlayer(browser, uniqueName('book'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Recipe Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // The world is full-screen: two handles, trays shut, Sprout's first-time hint.
  await expect
    .poll(() => traysState(page))
    .toMatchObject({ visible: true, open: null, hint: true });
  await expect(page.getByTestId('tray-handle-adventure')).toBeVisible();
  await expect(page.getByTestId('tray-handle-heartpatch')).toBeVisible();
  await expect(page.getByTestId('bag-open')).toBeHidden();
  // Opening a tray answers the hint; one tray at a time.
  await openTray(page, 'adventure');
  expect(await traysState(page)).toMatchObject({ open: 'adventure', hint: false });
  await expect(page.getByTestId('battle-entry')).toBeVisible();
  await openTray(page, 'heartpatch');
  await expect(page.getByTestId('battle-entry')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await traysState(page))?.open).toBeNull();

  // The book: always-open pages for a new account, a sealed Jack-o'-Lantern.
  const mapId = (await mapState(page))!.id;
  await (await trayButton(page, 'recipe-book-open')).tap();
  const book = page.getByTestId('recipe-book');
  await expect(book).toBeVisible();
  await expect
    .poll(async () => (await bookState(page))?.unlocked ?? [])
    .toEqual(expect.arrayContaining(['recipe:heart-charm', 'building:hearthfire']));
  expect((await bookState(page))?.unlocked).not.toContain('recipe:jack-o-lantern-hearthfire');
  await page.getByTestId('recipe-book-cover-open').tap();
  await expect.poll(async () => (await bookState(page))?.showing[0]).toBe('contents');

  // The Heart Charm's page: have/need, where to find it, and Make it once the bag has it all.
  await book.locator('[data-testid="recipe-book-toc"][data-page="recipe:heart-charm"]').tap();
  const charm = book.locator('article[data-page="recipe:heart-charm"]');
  await expect(charm).toBeVisible();
  await expect(
    charm.locator('[data-ingredient="treats"] [data-testid="recipe-book-qty"]'),
  ).toHaveText('0/1');
  await expect(charm).toContainText('Forest');
  expect(findAvoidedWords((await charm.textContent()) ?? '')).toEqual([]);
  const make = charm.getByTestId('recipe-book-make');
  await expect(make).toBeDisabled();
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 2, treats: 1 },
  });
  expect(granted.status).toBe(201);
  // Reopen the book: it reads the bag fresh.
  await page.getByTestId('recipe-book-close').tap();
  await (await trayButton(page, 'recipe-book-open')).tap();
  await page.getByTestId('recipe-book-cover-open').tap();
  await book.locator('[data-testid="recipe-book-toc"][data-page="recipe:heart-charm"]').tap();
  await expect(
    charm.locator('[data-ingredient="treats"] [data-testid="recipe-book-qty"]'),
  ).toHaveText('1/1');
  await expect(make).toBeEnabled();
  await make.tap();
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);
  await expect(page.getByTestId('recipe-book-say')).toContainText('Making Heart Charm');

  // The server refuses a sealed page, whatever the bag holds (CLAUDE.md rule 1).
  const sealed = await api<{ error: { code: string } }>(page, 'POST', `/maps/${mapId}/crafts`, {
    recipeId: 'jack-o-lantern-hearthfire',
  });
  expect(sealed.status).toBeGreaterThanOrEqual(400);

  // Search finds open pages by ingredient, never sealed ones.
  await page.getByTestId('recipe-book-search').tap();
  await page.getByTestId('recipe-book-search-input').fill('witch');
  await expect(page.getByTestId('recipe-book-results')).toContainText('No pages match');
  await page.getByTestId('recipe-book-search-input').fill('stone');
  const results = page.getByTestId('recipe-book-results');
  await expect(results.locator('[data-page="building:hearthfire"]')).toBeVisible();
  await results.locator('[data-page="building:hearthfire"]').tap();
  await expect.poll(async () => (await bookState(page))?.showing).toContain('building:hearthfire');

  // Find on map: closes the book and taps the player's own Stone tile.
  const fire = book.locator('article[data-page="building:hearthfire"]');
  await fire.locator('[data-resource="stone"]').tap();
  await expect(book).toBeHidden();
  await expect.poll(async () => (await mapState(page))?.selected ?? null).not.toBeNull();
  await expect(page.getByTestId('tile-panel')).toBeVisible();

  expect(errors).toEqual([]);
});
