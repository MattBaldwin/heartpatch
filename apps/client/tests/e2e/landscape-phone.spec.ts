import { expect, test, type Locator, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { settled, still } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { openTray } from './trays.js';

// A phone on its side (controls D): the screens that used to leave no room
// (the wardrobe showed zero rows of clothes) show their controls and rows,
// and every control is on screen and the thing a tap would hit. Measured as
// boxes and hit tests, never pixels.

const LANDSCAPE_PHONES = [
  { name: 'iPhone landscape', width: 844, height: 390 },
  { name: 'iPhone SE landscape', width: 667, height: 375 },
] as const;

/** The control sits fully on screen and is what a tap at its middle lands on. */
async function expectReachable(control: Locator, what: string): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const problems = await control.evaluate((el) => {
    const out: string[] = [];
    const b = el.getBoundingClientRect();
    if (
      b.left < -0.5 ||
      b.top < -0.5 ||
      b.right > innerWidth + 0.5 ||
      b.bottom > innerHeight + 0.5
    ) {
      out.push(`off screen ${JSON.stringify([b.left, b.top, b.right, b.bottom].map(Math.round))}`);
    }
    if (b.height < 43.5) out.push(`under 44 px (${String(Math.round(b.height))})`);
    const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    if (!hit || !(el === hit || el.contains(hit))) out.push('something else is on top');
    return out;
  });
  expect(problems, what).toEqual([]);
}

async function boxOf(
  page: Page,
  selector: string,
): Promise<{ l: number; t: number; r: number; b: number }> {
  await still(page, selector);
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    });
}

test('the wardrobe and the catalog fit a phone on its side', async ({ browser }) => {
  test.setTimeout(240_000); // a map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('side'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Side Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();

  for (const size of LANDSCAPE_PHONES) {
    await test.step(`wardrobe, ${size.name}`, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.getByTestId('keeper-menu').tap();
      await page.getByRole('button', { name: /Wardrobe/ }).tap();
      const wardrobe = page.getByTestId('wardrobe');
      await expect(wardrobe).toBeVisible();
      await expect
        .poll(
          async () => (await hook<{ preview: string | null }>(page, 'wardrobe'))?.preview ?? null,
        )
        .not.toBeNull();
      await settled(page);
      // Rows of clothes: the list has room for at least one whole row.
      const items = await boxOf(page, '[data-testid="wardrobe-items"]');
      expect(items.b - items.t, 'room for clothes').toBeGreaterThanOrEqual(64);
      await expectReachable(
        wardrobe.locator('[data-testid="wardrobe-items"] button').first(),
        'first piece',
      );
      await expectReachable(page.getByTestId('wardrobe-done'), 'Done');
      await expectReachable(page.getByTestId('wardrobe-boutique'), 'Boutique');
      await expectReachable(page.getByTestId('wardrobe-turn'), 'Turn around');
      // The card and the Keeper's room don't overlap: the "Log out" chip stays clear of Done.
      const card = await boxOf(page, '.wardrobe-card');
      expect(card.r, 'card leaves the right of the screen').toBeLessThan(size.width * 0.7);
      await page.getByTestId('wardrobe-done').tap();
      await expect(wardrobe).toBeHidden();
    });
  }

  for (const size of LANDSCAPE_PHONES) {
    await test.step(`catalog, ${size.name}`, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openTray(page, 'adventure');
      await page.getByTestId('catalog-open').tap();
      const grid = page.getByTestId('catalog-grid');
      await expect(grid).toBeVisible();
      await settled(page);
      const sheet = await boxOf(page, '.catalog-scroll');
      expect(sheet.b - sheet.t, 'room for a row of squishies').toBeGreaterThanOrEqual(120);
      await expectReachable(page.locator('.catalog-close-top'), 'the round ×');
      await page.locator('.catalog-close-top').tap();
      await expect(grid).toBeHidden();
    });
  }
});
