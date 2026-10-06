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
  cooking: 'making' | 'ready' | null;
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
  expect(sealed.status).toBe(403);
  expect(sealed.body.error.code).toBe('FORBIDDEN');

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

// The owner's playtest of 2026-10-06: "Make it" said "You're already making
// something! Collect it first." with no Collect anywhere on the page. The
// book now shows what's cooking, counts down, and collects it itself.
test('the recipe book shows what’s cooking, collects it, then makes the next one', async ({
  browser,
}) => {
  test.setTimeout(150_000); // shader compiles, and Pumpkin Treats really cook for 30 s
  const page = await newPlayer(browser, uniqueName('pot'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Pot Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Pumpkins open the Pumpkin Treats page (Halloween is on: the dev server
  // runs on today's date, inside the 2026 window).
  const mapId = (await mapState(page))!.id;
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { pumpkins: 2, timber: 2, treats: 1 },
  });
  expect(granted.status).toBe(201);

  const book = page.getByTestId('recipe-book');
  const cooking = book.getByTestId('recipe-book-cooking');
  const turnTo = async (key: string) => {
    await page.getByTestId('recipe-book-cover-open').tap();
    await book.locator(`[data-testid="recipe-book-toc"][data-page="${key}"]`).tap();
  };
  await (await trayButton(page, 'recipe-book-open')).tap();
  await expect
    .poll(async () => (await bookState(page))?.unlocked ?? [])
    .toContain('recipe:pumpkin-treats');
  await expect(cooking).toBeHidden();
  await turnTo('recipe:pumpkin-treats');
  const treats = book.locator('article[data-page="recipe:pumpkin-treats"]');
  await treats.getByTestId('recipe-book-make').tap();
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);

  // Another page: the pot is busy, so Make it waits, and says why.
  await expect(cooking).toBeVisible();
  await expect(cooking).toContainText('Making Pumpkin Treats…');
  expect((await bookState(page))?.cooking).toBe('making');
  await book.getByTestId('recipe-book-next').tap();
  await expect
    .poll(async () => (await bookState(page))?.showing)
    .not.toContain('recipe:pumpkin-treats');
  await page.getByTestId('recipe-book-close').tap();
  await (await trayButton(page, 'recipe-book-open')).tap();
  await turnTo('recipe:heart-charm');
  const charm = book.locator('article[data-page="recipe:heart-charm"]');
  await expect(cooking).toContainText('Making Pumpkin Treats…');
  await expect(charm.getByTestId('recipe-book-make')).toBeDisabled();
  await expect(charm).toContainText('Your pot is busy! Collect first.');
  expect(findAvoidedWords((await cooking.textContent()) ?? '')).toEqual([]);
  // "Can make now" hides what the busy pot can't make.
  await book.getByTestId('recipe-book-can-make').tap();
  await expect(
    book.locator('[data-testid="recipe-book-toc"][data-page="recipe:heart-charm"]'),
  ).toHaveCount(0);
  await expect(cooking).toBeVisible();
  await book.getByTestId('recipe-book-can-make').tap();

  // Ready on the server's clock: the strip turns into Collect (no dev route
  // finishes a craft early, so this waits on the game's own signal).
  const collect = cooking.getByTestId('recipe-book-collect');
  await expect(collect).toBeVisible({ timeout: 45_000 });
  await expect(cooking).toContainText('Pumpkin Treats is ready!');
  await collect.tap();
  await expect(page.getByTestId('recipe-book-say')).toContainText('Yay! +3');
  await expect(cooking).toBeHidden();
  await expect.poll(async () => (await bagState(page))?.items['treats']).toBe(4);

  // The pot is free: make the Heart Charm.
  await book.locator('[data-testid="recipe-book-toc"][data-page="recipe:heart-charm"]').tap();
  await expect(charm.getByTestId('recipe-book-make')).toBeEnabled();
  await charm.getByTestId('recipe-book-make').tap();
  await expect(cooking).toContainText('Making Heart Charm…');
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);
  await page.getByTestId('recipe-book-close').tap();

  // The Bag lists it under Cooking too.
  await (await trayButton(page, 'bag-open')).tap();
  await expect(page.getByTestId('bag-crafts')).toContainText('Making Heart Charm');
  await page.getByTestId('bag').getByRole('button', { name: 'Close' }).tap();

  expect(errors).toEqual([]);
});

test('a craft started elsewhere shows up when Make it is refused', async ({ browser }) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const page = await newPlayer(browser, uniqueName('stale'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Stale Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  const mapId = (await mapState(page))!.id;
  expect(
    (
      await api(page, 'POST', `/maps/${mapId}/dev/items`, {
        items: { pumpkins: 1, timber: 2, treats: 1 },
      })
    ).status,
  ).toBe(201);
  const book = page.getByTestId('recipe-book');
  await (await trayButton(page, 'recipe-book-open')).tap();
  await expect
    .poll(async () => (await bookState(page))?.unlocked ?? [])
    .toContain('recipe:pumpkin-treats');
  await page.getByTestId('recipe-book-cover-open').tap();
  await book.locator('[data-testid="recipe-book-toc"][data-page="recipe:heart-charm"]').tap();
  const make = book
    .locator('article[data-page="recipe:heart-charm"]')
    .getByTestId('recipe-book-make');
  await expect(make).toBeEnabled();

  // Another device starts Pumpkin Treats behind the open book's back.
  const elsewhere = await api(page, 'POST', `/maps/${mapId}/crafts`, {
    recipeId: 'pumpkin-treats',
  });
  expect(elsewhere.status).toBe(201);

  // The server says no (CLAUDE.md rule 1); the book re-reads the bag and shows it.
  await make.tap();
  await expect(page.getByTestId('recipe-book-say')).toContainText('already making something');
  await expect(book.getByTestId('recipe-book-cooking')).toContainText('Making Pumpkin Treats…');
  await expect(make).toBeDisabled();
  expect((await bagState(page))?.crafts).toBe(1);

  expect(errors).toEqual([]);
});
