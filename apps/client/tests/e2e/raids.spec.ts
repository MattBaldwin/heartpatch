import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * The raid report on an iPhone (issue #16): a Report button over my patch
 * opens the raid report, and I pick how my squishies on watch play when
 * someone challenges my land. Checked through the dev hook, never pixels.
 * (A real challenge needs a second player past the 48 h shield; the server
 * tests cover the raid log itself.)
 */

/** `RaidReportDebug` from src/raids/raid-report.ts (this project can't see its types). */
interface RaidReportDebug {
  mapId: string;
  stance: 'aggressive' | 'defensive' | 'balanced';
  raids: number;
  unseen: number;
  open: boolean;
}

const raidState = (page: Page) => hook<RaidReportDebug>(page, 'raids');

test('opens the raid report and saves a defense style', async ({ browser }) => {
  test.setTimeout(120_000); // a full map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('raid'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Report Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();

  // Nothing new on a brand-new patch, so the report waits behind its button.
  // Roomy: the map builds first, and CI renders in software.
  await expect
    .poll(async () => (await raidState(page))?.stance ?? null, { timeout: 30_000 })
    .toBe('balanced');
  expect(await raidState(page)).toMatchObject({ raids: 0, unseen: 0, open: false });

  await (await trayButton(page, 'raid-open')).tap();
  const sheet = page.getByTestId('raid-report');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('raid-quiet')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Balanced/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await sheet.getByRole('button', { name: /Bold/ }).tap();
  await expect(sheet.getByTestId('raid-note')).toHaveText('Your squishies will play Bold!');
  await expect(sheet.getByRole('button', { name: /Bold/ })).toHaveAttribute('aria-pressed', 'true');
  expect((await raidState(page))?.stance).toBe('aggressive');
  // Kid-safe words only (style guide §9).
  expect(findAvoidedWords((await sheet.textContent()) ?? '')).toEqual([]);

  await sheet.getByTestId('raid-done').tap();
  await expect(sheet).toBeHidden();

  // The server kept it: a fresh load lands back on the patch (#160) and reads it back.
  await page.reload();
  await expect(page.getByTestId('map-hud')).toContainText('Report Patch', { timeout: 30_000 });
  await expect(lobby).toBeHidden();
  await expect
    .poll(async () => (await raidState(page))?.stance ?? null, { timeout: 30_000 })
    .toBe('aggressive');
  expect(errors).toEqual([]);
});
