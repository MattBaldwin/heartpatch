import { expect, test } from '@playwright/test';
import { expectClear, settled, still } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';
import { careFromRoster } from './roster.js';

const slowExpect = expect.configure({ timeout: 30_000 });

/**
 * The care sheet and the Keeper chip (#385): the chip floats over every sheet
 * (z 10), so the sheet keeps its name, rarity and mood clear of it, scrolls as
 * one area, and keeps Feed, Pet and Play on screen. Measured as boxes, never
 * pixels; a screenshot of each size is saved with the test's output.
 */

const SIZES = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-15', width: 393, height: 852 },
  // An iPhone 15 installed to the home screen: the status bar and home
  // indicator take about 93px of 852 (about what Safari's own bars take too).
  { name: 'iphone-15-installed', width: 393, height: 759 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'iphone-15-pro-max', width: 430, height: 932 },
  { name: 'iphone-se-landscape', width: 667, height: 375 },
  { name: 'ipad-portrait', width: 820, height: 1180 },
  { name: 'ipad-landscape', width: 1180, height: 820 },
] as const;

const COVERED = [
  '[data-testid="care-name"]',
  '[data-testid="care-rarity"]',
  '[data-testid="care-mood"]',
  '[data-testid="care-drift"]',
].join(', ');

test('the Keeper chip never covers the care sheet, and the sheet scrolls as one area', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('carefit'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Fit Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await (await trayButton(page, 'battle-dev-grant')).tap();
  await slowExpect(page.locator('.battle-entry-note')).toContainText('joined you');
  await (await trayButton(page, 'home-open')).tap();
  const sheet = page.getByTestId('care');
  const openSheet = async () => {
    await careFromRoster(page);
    await slowExpect(sheet).toBeVisible();
    await slowExpect(page.getByTestId('care-mood')).not.toBeEmpty();
  };

  for (const size of SIZES) {
    await test.step(size.name, async () => {
      // Opened at this size, as a player on this phone would.
      await page.setViewportSize({ width: size.width, height: size.height });
      await settled(page);
      await openSheet();
      await still(page, '[data-testid="care"] button');
      // It opens at the top: a sheet already scrolled would slide the name
      // under the chip.
      expect(await sheet.evaluate((el) => el.scrollTop), 'the sheet opens at its top').toBe(0);
      await page.screenshot({ path: test.info().outputPath(`${size.name}.png`) });

      // The chip never sits over the name, rarity or mood (it fails if any of
      // them, or the chip, isn't on screen).
      await expectClear(page, '.auth-chip', COVERED);

      // The care notes stay open (decisions: "Care explains itself").
      await expect(page.getByTestId('care-details')).toHaveJSProperty('open', true);

      // One scroll area: the sheet scrolls itself and nothing in it does.
      const nested = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="care"] *')]
          .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))
          .map((el) => el.className),
      );
      expect.soft(nested, 'no scroller inside the sheet').toEqual([]);

      // 44pt targets, both ways.
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="care"] button, [data-testid="care"] summary',
          ),
        ]
          .filter((el) => !el.closest('[hidden]'))
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.height < 44 || box.width < 44)
          .map(({ el }) => el.textContent.trim()),
      );
      expect.soft(small, 'every button is at least 44pt each way').toEqual([]);

      // Feed, Pet and Play are on screen without scrolling (a phone on its
      // side shows the top of the sheet and scrolls once).
      if (size.name !== 'iphone-se-landscape') {
        const bottom = await page
          .locator('[data-tutorial-target="care-buttons"]')
          .evaluate((el) => el.getBoundingClientRect().bottom);
        expect
          .soft(bottom, 'Feed, Pet and Play end above the screen bottom')
          .toBeLessThanOrEqual(size.height);
      }

      // How much the sheet scrolls here, for the PR (iPad portrait and the
      // taller iPhones need none).
      const spill = await sheet.evaluate((el) => el.scrollHeight - el.clientHeight);
      test.info().annotations.push({ type: size.name, description: `scrolls ${String(spill)}px` });

      await page.getByTestId('care-close').tap();
      await slowExpect(sheet).toBeHidden();
    });
  }
});
