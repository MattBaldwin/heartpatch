import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { settled } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

const slowExpect = expect.configure({ timeout: 30_000 });

/**
 * The care sheet and the Keeper chip (#385): the chip floats over every sheet
 * (z 10), so the sheet keeps its title, rarity and mood clear of it, and the
 * whole sheet fits one scroll area. Measured as boxes, never pixels. Set
 * HP_SHOTS_DIR to also save a screenshot of each size.
 */

const SIZES = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-15', width: 393, height: 852 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'iphone-15-pro-max', width: 430, height: 932 },
  { name: 'iphone-se-landscape', width: 667, height: 375 },
  { name: 'ipad-portrait', width: 820, height: 1180 },
  { name: 'ipad-landscape', width: 1180, height: 820 },
] as const;

type Box = { l: number; t: number; r: number; b: number };

/** Boxes of the visible matches of `selector`, keyed by selector. */
async function boxOf(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((selector) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el || el.closest('[hidden]')) return null;
    const b = el.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }, selector);
}

const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

test('the Keeper chip never covers the care sheet, and the sheet fits one scroll area', async ({
  browser,
}) => {
  test.setTimeout(180_000);
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
    await page.getByTestId('home-friends').locator('[data-care-squishy]').first().tap();
    await slowExpect(sheet).toBeVisible();
    await slowExpect(page.getByTestId('care-mood')).not.toBeEmpty();
  };

  const shots = process.env['HP_SHOTS_DIR'];
  if (shots) mkdirSync(shots, { recursive: true });

  for (const size of SIZES) {
    await test.step(size.name, async () => {
      // Opened at this size, as a player on this phone would.
      await page.setViewportSize({ width: size.width, height: size.height });
      await settled(page);
      await openSheet();
      await settled(page);
      if (shots) await page.screenshot({ path: `${shots}/${size.name}.png` });

      const chip = await boxOf(page, '.auth-chip');
      expect.soft(chip, 'the Keeper chip is on screen').not.toBeNull();
      for (const id of ['care-name', 'care-rarity', 'care-mood', 'care-drift']) {
        const target = await boxOf(page, `[data-testid="${id}"]`);
        if (target && chip)
          expect.soft(overlaps(chip, target), `${id} clear of the chip`).toBe(false);
      }

      // One scroll area: the sheet scrolls itself, nothing inside it does, and
      // the card's buttons are 44pt targets.
      const inner = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="care"] *')]
          .filter((el) => {
            const overflow = getComputedStyle(el).overflowY;
            return (
              (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight
            );
          })
          .map((el) => el.className),
      );
      expect.soft(inner, 'no scroller inside the sheet').toEqual([]);
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="care"] button, [data-testid="care"] summary',
          ),
        ]
          .filter((el) => !el.closest('[hidden]'))
          .map((el) => ({
            name: el.textContent.trim(),
            h: el.getBoundingClientRect().height,
          }))
          .filter((b) => b.h < 44),
      );
      expect.soft(small, 'every button is at least 44pt tall').toEqual([]);

      // The sheet fits without scrolling at the sizes a phone holds upright
      // and an iPad; a phone on its side is allowed to scroll the sheet.
      if (!size.name.endsWith('landscape') || size.name.startsWith('ipad')) {
        const spill = await sheet.evaluate((el) => el.scrollHeight - el.clientHeight);
        expect.soft(spill, 'the sheet fits the screen').toBeLessThanOrEqual(0);
      }
      await page.getByTestId('care-close').tap();
      await slowExpect(sheet).toBeHidden();
    });
  }
});
