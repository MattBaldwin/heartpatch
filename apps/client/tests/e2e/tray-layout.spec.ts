import { expect, test, type Locator, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { expectClear, expectRoomyLabels, SCREENS } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { openTray, trayButton, traySettled } from './trays.js';

// The owner's rule after two edge-to-edge labels: text never touches a
// control's edge, and nothing hangs off the screen (style guide §3). Every
// tray handle and row, the Keeper menu, the tile chip, the catalog's and the
// care sheet's controls and the recipe book's, on a small phone, a big phone
// and an iPad both ways round.

const TRAY_CONTROLS = [
  '[data-testid^="tray-handle-"]',
  '.tray-section > button',
  '.tray-section > .battle-entry-box > button',
  '.tray-jobs .jobs-entry > button',
  '.tray-close',
  '.tray-top-left > button',
].join(', ');

/**
 * Taps `target` to turn the book, then waits until the turn has been drawn
 * and the book says it shows `key`. Every turn replaces the spread element
 * (recipe-book.ts render), so a new element proves the tap's click ran, even
 * when `key` was already on the spread (two-up pairs contents with the first
 * recipe). WebKit's tap-to-click can land late; measuring before it did
 * caught the fresh spread at its turn's first keyframe, rotateY(60deg), half
 * as wide. expectRoomyLabels then waits for the turn to end.
 */
async function turnTo(page: Page, target: Locator, key: string): Promise<void> {
  const spread = await page.getByTestId('recipe-book-spread').elementHandle();
  await target.tap();
  await page.waitForFunction(
    (before) => document.querySelector('[data-testid="recipe-book-spread"]') !== before,
    spread,
  );
  await expect
    .poll(async () => (await hook<{ showing: string[] }>(page, 'recipeBook'))?.showing ?? [])
    .toContain(key);
}

async function checkTrays(page: Page): Promise<void> {
  await expectRoomyLabels(page, '[data-testid^="tray-handle-"], .tray-top-left > button');
  for (const side of ['adventure', 'heartpatch'] as const) {
    await openTray(page, side);
    await traySettled(page, side);
    await expectRoomyLabels(page, TRAY_CONTROLS);
  }
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await hook<{ open: string | null }>(page, 'trays'))?.open)
    .toBeNull();
}

async function checkKeeperMenu(page: Page): Promise<void> {
  await page.getByTestId('keeper-menu').tap();
  await expectRoomyLabels(page, '.auth-chip-menu > button, .auth-chip-body > .auth-button');
  await page.getByTestId('keeper-menu').tap();
}

async function checkTileChip(page: Page): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.width / 2, box.height / 2);
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  // The × is an icon, not a label: where its glyph box sits depends only on
  // the font's metrics (7 px in the CI container's fonts), not on the layout.
  await expectRoomyLabels(page, '.tile-panel button:not(.tile-panel-close)');
  await panel.getByRole('button', { name: 'Close' }).tap();
}

/**
 * The catalog's header × and, from a friend's card, the care sheet's round
 * buttons ("Feed" with its Treats under it) and its × (#150, #153).
 */
async function checkCatalogAndCare(page: Page): Promise<void> {
  await (await trayButton(page, 'catalog-open')).tap();
  const catalog = page.getByTestId('catalog');
  await expect(catalog).toBeVisible();
  await expect(catalog.locator('[data-care-species]').first()).toBeVisible({ timeout: 15_000 });
  await expectRoomyLabels(page, '.catalog-close-top, [data-testid="catalog-close"]');
  // The × is in the header, on screen without scrolling the list.
  const close = (await page.getByTestId('catalog-close-top').boundingBox())!;
  expect(close.y + close.height).toBeLessThan(page.viewportSize()!.height / 2);
  await catalog.locator('[data-care-species]').first().tap();
  const care = page.getByTestId('care');
  await expect(care).toBeVisible();
  await expect(care.locator('[data-care="feed"]')).toBeVisible();
  await expectRoomyLabels(page, '.care-actions .care-action, [data-testid="care-close"]');
  await care.getByTestId('care-close').tap();
  await expect(care).toBeHidden();
  await page.getByTestId('catalog-close-top').tap();
  await expect(catalog).toBeHidden();
}

async function checkBook(page: Page): Promise<void> {
  await (await trayButton(page, 'recipe-book-open')).tap();
  const book = page.getByTestId('recipe-book');
  await expect(book).toBeVisible();
  const later = book.getByRole('button', { name: 'Later' });
  if (await later.isVisible()) await later.tap();
  await expectRoomyLabels(page, '.rbook-open, .rbook-btn');
  await turnTo(page, page.getByTestId('recipe-book-cover-open'), 'contents');
  await expectRoomyLabels(page, '.rbook-mark, .rbook-tab, .rbook-toc, .rbook-nav-btn');
  await turnTo(
    page,
    book.locator('[data-testid="recipe-book-toc"][data-page="recipe:heart-charm"]'),
    'recipe:heart-charm',
  );
  await expectRoomyLabels(page, '.rbook-find, .rbook-stamp');
  await page.getByTestId('recipe-book-close').tap();
}

test('text never touches a control’s edge, on phones and iPads', async ({ browser }) => {
  test.setTimeout(300_000); // six screens; CI renders in software
  const page = await newPlayer(browser, uniqueName('room'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Roomy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Sprout's first-visit hint stays small and clear of both handles it points at.
  await expect(page.getByTestId('tray-hint')).toBeVisible();
  for (const screen of SCREENS) {
    await test.step(`${screen.name}: Sprout's hint`, async () => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.waitForTimeout(300);
      await expectClear(page, '[data-testid="tray-hint"]', '[data-testid^="tray-handle-"]');
      await expectRoomyLabels(page, '[data-testid="tray-hint-ok"]');
      const hint = (await page.getByTestId('tray-hint').boundingBox())!;
      // Compact on a phone (owner: about 65% of the width at most).
      if (screen.width < 600) expect(hint.width).toBeLessThanOrEqual(screen.width * 0.66);
    });
  }
  await page.getByTestId('tray-hint-ok').tap();
  await expect(page.getByTestId('tray-hint')).toBeHidden();

  for (const screen of SCREENS) {
    await test.step(screen.name, async () => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.waitForTimeout(300);
      await checkTrays(page);
      await checkKeeperMenu(page);
      await checkTileChip(page);
      await checkCatalogAndCare(page);
      await checkBook(page);
    });
  }
});
