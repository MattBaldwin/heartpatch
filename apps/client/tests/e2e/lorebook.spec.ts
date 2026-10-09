import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { closeTrays, trayButton } from './trays.js';

/**
 * The Lorebook (#307): a page found (the dev route stands in for exploring)
 * pops its card on the next map open, the Bag button and the Bag's Lorebook
 * tile sparkle until it's read, the tile opens the book at the contents, a
 * chapter opens at its new page, the next page is a blank with a hint and no
 * words, and reading it clears the sparkle (kept on the server). "Open
 * Lorebook" on a card opens the book at that page. Checked through the dev
 * hook's signals, never pixels.
 */

/** `LorebookDebug` from src/lore/lorebook.ts (this project can't see its types). */
interface LoreDebug {
  showing: string | null;
  bookOpen: boolean;
  bookAt: string | null;
  found: number;
  total: number;
  unread: number;
}

/** WebKit's page error for an in-flight API fetch a reload aborts (as in hollow.spec.ts). */
const ABORTED_FETCH = /\/api\/v1\/\S* due to access control checks\.?$/;

const loreState = (page: Page) => hook<LoreDebug>(page, 'lore');
const mapState = (page: Page) => hook<{ live: string | null }>(page, 'map');
const slow = { timeout: 30_000 };

test('a found page sparkles in the Bag, opens in the Lorebook and is read', async ({ browser }) => {
  test.setTimeout(150_000); // map builds and two reloads; CI renders in software
  const page = await newPlayer(browser, uniqueName('lore'));
  const errors: string[] = [];
  let reloading = false;
  page.on('pageerror', (err) => {
    if (reloading && ABORTED_FETCH.test(err.message)) return;
    errors.push(err.message);
  });
  const reload = async () => {
    reloading = true;
    await page.reload();
    reloading = false;
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', slow);
    await expect.poll(async () => (await mapState(page))?.live, slow).toBe('live');
  };

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Story Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', slow);
  await expect.poll(async () => (await loreState(page))?.total, slow).toBe(12);
  expect((await loreState(page))?.found).toBe(0);

  // A page is found while exploring; the next map open shows its card.
  const found = await api(page, 'POST', '/lore/dev/find', { pageId: 'under-a-mossy-rock' });
  expect(found.status).toBe(200);
  await reload();
  const card = page.getByTestId('lore-card');
  await expect(card).toBeVisible(slow);
  await expect(card.getByTestId('lore-title')).toHaveText('Under a Mossy Rock');
  await expect(card.getByTestId('lore-open-book')).toBeVisible();
  await card.getByTestId('lore-close').tap();
  await expect(card).toBeHidden();

  // Not read yet: the Bag button sparkles, and so does the Bag's Lorebook tile.
  await expect.poll(async () => (await loreState(page))?.unread, slow).toBe(1);
  const bagButton = await trayButton(page, 'bag-open');
  await expect(bagButton.getByTestId('bag-open-lore')).toHaveText('1');
  await bagButton.tap();
  const bag = page.getByTestId('bag');
  await expect(bag).toBeVisible();
  const tile = bag.getByTestId('bag-lorebook');
  await expect(tile).toBeVisible();
  await expect(tile.getByTestId('bag-lorebook-count')).toHaveText('1 of 12 pages found');
  await expect(tile.getByTestId('bag-lorebook-new')).toHaveText('1 new');

  // The tile opens the book at its contents.
  await tile.tap();
  const book = page.getByTestId('lorebook');
  await expect(book).toBeVisible();
  await expect(book.getByTestId('lorebook-count')).toHaveText('Pages found: 1 of 12');
  await expect(book.getByTestId('lorebook-chapter')).toHaveCount(4);
  expect((await loreState(page))?.bookAt).toBeNull();

  // The Wild Lands opens at its new page, in full.
  await book.locator('[data-testid="lorebook-chapter"][data-chapter="wild-lands"]').tap();
  await expect.poll(async () => (await loreState(page))?.bookAt).toBe('under-a-mossy-rock');
  const shown = book.locator('[data-testid="lorebook-page"][data-found="true"]');
  await expect(shown.getByTestId('lorebook-page-title')).toHaveText('Under a Mossy Rock');
  await expect(shown.getByTestId('lorebook-page-text')).toContainText('tiny silver bell');
  // Read now: the sparkle goes, on the server too.
  await expect.poll(async () => (await loreState(page))?.unread, slow).toBe(0);
  await expect(tile.getByTestId('bag-lorebook-new')).toBeHidden();

  // The next page is still to find: a hint, never its words.
  await book.getByTestId('lorebook-next').tap();
  await expect.poll(async () => (await loreState(page))?.bookAt).toBe('the-humming-reeds');
  const blank = book.locator('[data-testid="lorebook-page"][data-found="false"]');
  await expect(blank).toContainText('A page still to find');
  const hint = (await blank.getByTestId('lorebook-hint').textContent()) ?? '';
  expect(hint).toContain('Some water hums, if you listen.');
  expect(findAvoidedWords(hint)).toEqual([]);
  await expect(book).not.toContainText('The Humming Reeds');
  await book.getByTestId('lorebook-prev').tap();
  await expect.poll(async () => (await loreState(page))?.bookAt).toBe('under-a-mossy-rock');

  // Close: back to the Bag.
  await book.getByTestId('lorebook-close').tap();
  await expect(book).toBeHidden();
  await expect(bag).toBeVisible();
  const lore = await api<{ slots: { id: string; found: boolean; readAt?: string | null }[] }>(
    page,
    'GET',
    '/lore',
  );
  expect(lore.body.slots.find((s) => s.id === 'under-a-mossy-rock')?.readAt).toEqual(
    expect.any(String),
  );

  // "Open Lorebook" on a found card opens the book at that page.
  await api(page, 'POST', '/lore/dev/find', { pageId: 'two-watchful-dogs' });
  await reload();
  await closeTrays(page);
  await expect(card).toBeVisible(slow);
  await expect(card.getByTestId('lore-title')).toHaveText('Two Watchful Dogs');
  await card.getByTestId('lore-open-book').tap();
  await expect(card).toBeHidden();
  await expect(book).toBeVisible();
  await expect.poll(async () => (await loreState(page))?.bookAt).toBe('two-watchful-dogs');
  await expect(book.getByTestId('lorebook-new')).toBeVisible();
  await expect.poll(async () => (await loreState(page))?.unread, slow).toBe(0);
  await book.getByTestId('lorebook-close').tap();
  await expect(book).toBeHidden();
  expect(errors).toEqual([]);
});
