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
  cooking: 'making' | null;
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
// something! Collect it first." with no Collect anywhere. Now the book shows
// what's cooking with a countdown, and a finished craft goes straight into
// the bag with a pop-up, so the next Make it just works.
test('the recipe book shows what’s cooking, and a finished craft lands by itself', async ({
  browser,
}) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
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
    items: { pumpkins: 1, timber: 2, treats: 1 },
  });
  expect(granted.status).toBe(201);

  const book = page.getByTestId('recipe-book');
  const cooking = book.getByTestId('recipe-book-cooking');
  const toc = (key: string) => book.locator(`[data-testid="recipe-book-toc"][data-page="${key}"]`);
  const openBookAt = async (key: string) => {
    await (await trayButton(page, 'recipe-book-open')).tap();
    await page.getByTestId('recipe-book-cover-open').tap();
    await toc(key).tap();
  };
  // The Pumpkins open a new page: its "New page!" card turns to it.
  await (await trayButton(page, 'recipe-book-open')).tap();
  await expect
    .poll(async () => (await bookState(page))?.unlocked ?? [])
    .toContain('recipe:pumpkin-treats');
  await page.getByTestId('recipe-book-new-turn').tap();
  await expect
    .poll(async () => (await bookState(page))?.showing)
    .toContain('recipe:pumpkin-treats');

  // Every line the "landed" pop-up shows, kept: it shows for a few seconds,
  // and on a slow software-rendered iPad the 30-second craft can land by
  // itself (the bag's own timer) before the dev route below finishes it.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { landedToasts: string[] }).landedToasts = seen;
    const node = document.querySelector('[data-testid="landed-toast"]');
    if (!node) return;
    new MutationObserver(() => {
      if (node.textContent) seen.push(node.textContent);
    }).observe(node, { childList: true, characterData: true, subtree: true });
  });
  const landedToasts = () =>
    page.evaluate(() => (window as unknown as { landedToasts: string[] }).landedToasts.join(' | '));

  // Make Pumpkin Treats.
  await expect(cooking).toBeHidden();
  const treats = book.locator('article[data-page="recipe:pumpkin-treats"]');
  await treats.getByTestId('recipe-book-make').tap();
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);

  // On another page: the pot is busy, with a countdown, so Make it waits.
  await expect(cooking).toBeVisible();
  await expect(cooking).toContainText('Your pot is busy making Pumpkin Treats…');
  expect((await bookState(page))?.cooking).toBe('making');
  await page.getByTestId('recipe-book-close').tap();
  await openBookAt('recipe:heart-charm');
  const charm = book.locator('article[data-page="recipe:heart-charm"]');
  await expect(cooking).toContainText('Pumpkin Treats');
  await expect(charm.getByTestId('recipe-book-make')).toBeDisabled();
  await expect(charm).toContainText('Your pot is busy! Watch the timer up top.');
  expect(findAvoidedWords((await cooking.textContent()) ?? '')).toEqual([]);
  await expect(book.getByRole('button', { name: /Collect/ })).toHaveCount(0);
  // "Can make now" hides what the busy pot can't make; the strip stays.
  await book.getByTestId('recipe-book-can-make').tap();
  await expect(toc('recipe:heart-charm')).toHaveCount(0);
  await expect(cooking).toBeVisible();
  await book.getByTestId('recipe-book-can-make').tap();

  // Time passes (the dev route finishes the craft now, if the bag's timer
  // hasn't already): reopening the book settles, and the Treats land with a
  // pop-up, no Collect tap.
  await page.getByTestId('recipe-book-close').tap();
  expect((await api(page, 'POST', `/maps/${mapId}/dev/crafts/ready`)).status).toBe(200);
  await openBookAt('recipe:heart-charm');
  await expect.poll(async () => (await bagState(page))?.items['treats']).toBe(4);
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(0);
  await expect.poll(landedToasts).toContain('+3 Treats');
  await expect(cooking).toBeHidden();

  // The pot is free: make the Heart Charm.
  await expect(charm.getByTestId('recipe-book-make')).toBeEnabled();
  await charm.getByTestId('recipe-book-make').tap();
  await expect(cooking).toContainText('Your pot is busy making Heart Charm…');
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);
  await page.getByTestId('recipe-book-close').tap();

  // The Bag lists it under Cooking, with no Collect.
  await (await trayButton(page, 'bag-open')).tap();
  await expect(page.getByTestId('bag-crafts')).toContainText('Making Heart Charm');
  await expect(page.getByTestId('bag').getByRole('button', { name: /Collect/ })).toHaveCount(0);
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
  // The Pumpkins' new page can wait.
  await page.getByTestId('recipe-book-new-page').getByRole('button', { name: 'Later' }).tap();
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
  await expect(page.getByTestId('recipe-book-say')).toContainText('still cooking');
  await expect(book.getByTestId('recipe-book-cooking')).toContainText('Pumpkin Treats');
  await expect(make).toBeDisabled();
  expect((await bagState(page))?.crafts).toBe(1);

  expect(errors).toEqual([]);
});
