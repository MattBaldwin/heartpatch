import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });

/** The map's id once its debug view exists: the hook is null for a moment after the map is up (#429). */
async function mapIdOf(page: Page): Promise<string> {
  await slowExpect.poll(async () => (await hook<{ id: string }>(page, 'map'))?.id).toBeTruthy();
  return (await hook<{ id: string }>(page, 'map'))!.id;
}
const slow = { timeout: 30_000 };

/**
 * Squishies wear their accessory everywhere they're drawn (#373): dress one
 * at home, and the battle arena draws it (the server's battle view carries
 * it). Explore draws no team since #501 (it waits at home). Checked through
 * the dev hook's accessory counts, never pixels.
 */

const scene = <T>(page: Page, name: 'battle') =>
  hook<{ scene: T | null }>(page, name).then((s) => s?.scene ?? null);

// Every test opens its own player (newPlayer); a page left mid-battle keeps
// drawing, which starves the next test's pages when rendering is in software
// (#397). Close them all when the test is done.
test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('the battle arena draws what my squishy wears, and a wild one wears nothing', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await newPlayer(browser, uniqueName('wearb'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Arena Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();

  const map = await mapIdOf(page);
  const care = await api<{ squishies: { id: string }[] }>(page, 'GET', `/maps/${map}/care`);
  for (const s of care.body.squishies) {
    expect(
      (await api(page, 'POST', `/maps/${map}/squishies/${s.id}/accessory`, { itemId: 'tiny-bow' }))
        .status,
    ).toBe(200);
  }

  await (await trayButton(page, 'battle-entry')).waitFor();
  await (await trayButton(page, 'battle-dev-fight')).tap();
  await expect(page.getByTestId('battle-hud')).toBeVisible();
  await expect
    .poll(async () => (await scene<{ squishies: number }>(page, 'battle'))?.squishies, slow)
    .toBe(2);
  // Mine are dressed; the wild opponent isn't (so fewer than every squishy built).
  const dressed = (await scene<{ accessories: number }>(page, 'battle'))!.accessories;
  expect(dressed).toBeGreaterThan(0);
  expect(dressed).toBeLessThanOrEqual(care.body.squishies.length);
});
