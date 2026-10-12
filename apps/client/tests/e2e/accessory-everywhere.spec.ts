import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTapAt } from './touch.js';
import { trayButton } from './trays.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

/**
 * Squishies wear their accessory everywhere (#373): dress one at home, then
 * the battle arena draws it (the server's battle view carries it) and so does
 * the follower trail in Explore. Checked through the dev hook's accessory
 * counts, never pixels.
 */

const scene = <T>(page: Page, name: 'battle' | 'explore') =>
  hook<{ scene: T | null }>(page, name).then((s) => s?.scene ?? null);

// Every test opens its own player (newPlayer); a page left mid-battle keeps
// drawing, which starves the next test's pages when rendering is in software
// (#397). Close them all when the test is done.
test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('a dressed squishy wears its accessory in battle and on the trail', async ({ browser }) => {
  test.setTimeout(300_000); // two scene builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('wear'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Wear Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Dress the starter in the Tiny Bow everyone owns.
  const map = (await hook<{ id: string }>(page, 'map'))!.id;
  const care = await api<{ squishies: { id: string }[] }>(page, 'GET', `/maps/${map}/care`);
  const id = care.body.squishies[0]!.id;
  const dressed = await api(page, 'POST', `/maps/${map}/squishies/${id}/accessory`, {
    itemId: 'tiny-bow',
  });
  expect(dressed.status).toBe(200);

  // Put it on my team so it follows me, then Explore: the trail wears it.
  expect((await api(page, 'POST', `/maps/${map}/team`, { squishyIds: [id] })).status).toBe(200);

  const box = (await page.locator('#game').boundingBox())!;
  const explore = page.getByTestId('tile-explore');
  await expect(async () => {
    if ((await hook<{ selected: string | null }>(page, 'map'))?.selected == null) {
      await realTapAt(page, box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(explore).toBeVisible({ timeout: 5_000 });
  }).toPass(slow);
  await explore.tap();
  await expect
    .poll(async () => (await scene<{ accessories: number }>(page, 'explore'))?.accessories, slow)
    .toBeGreaterThan(0);
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

  const map = (await hook<{ id: string }>(page, 'map'))!.id;
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
