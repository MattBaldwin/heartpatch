import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { selectTile } from './claim-land.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Clearing land from a tile's Build sheet (#242), on the owner's own case: a
 * fully explored mountain with a Stone pile in its middle. Before the fix an
 * explored tile that hadn't joined home showed no Clear land at all (no Build
 * button, or a sheet of fences only) and nothing said why. Now the header says
 * whether it's a homestead, the fire line points to clearing, and Build shows
 * Clear land held back with the reason; on a joined one it clears.
 */

interface TileBuildDebug {
  mode: 'card' | 'build' | null;
  cards: string[];
  selected: string | null;
}

const slowExpect = expect.configure({ timeout: 30_000 });
const buildState = (page: Page) => hook<TileBuildDebug>(page, 'tileBuild');

test('clears a joined mountain homestead, and says why an unjoined one waits', async ({
  browser,
}) => {
  test.setTimeout(180_000); // CI renders in software
  const page = await newPlayer(browser, uniqueName('clearer'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Rocky Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Rocky Patch')!.id;
  // Two explored mountains with a Stone pile (dev route): one three steps
  // out that hasn't joined home, one beside home that has.
  const mountain = (joined: boolean) =>
    api<{ q: number; r: number }>(page, 'POST', `/maps/${mapId}/dev/homestead`, {
      terrain: 'mountains',
      nodeResource: 'stone',
      joined,
    });
  const away = await mountain(false);
  expect(away.status).toBe(201);
  const near = await mountain(true);
  expect(near.status).toBe(201);
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/items`, { items: { pickaxe: 1 } })).status,
  ).toBe(201);
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const panel = page.getByTestId('tile-panel');

  // Not joined: the panel says so, and Build holds Clear land back with why.
  await selectTile(page, away.body);
  await slowExpect(panel.getByTestId('tile-panel-owner')).toHaveText(
    'Your land, explored ✨. It must touch home to be a homestead.',
  );
  await expect(panel.locator('#tile-panel-title')).toHaveText('Mountains');
  await expect(panel).toContainText("Once it's a homestead, a Pickaxe can clear it 🌱");
  await panel.getByTestId('tile-build').tap();
  await expect.poll(async () => (await buildState(page))?.cards[0]).toBe('clear-land');
  // A held-back card is aria-disabled but still taps, to say why (#242 3b-1).
  await page.locator('[data-build="clear-land"]').tap({ force: true });
  await expect(page.getByTestId('build-detail')).toContainText(
    'Clear land works on homesteads: land that touches your home 🏡.',
  );
  await expect(page.getByTestId('build-go')).toBeDisabled();
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);
  await page.getByTestId('build-sheet').getByRole('button', { name: 'Not now' }).tap();

  // Joined: the fire line offers the Pickaxe, and Clear land starts.
  await selectTile(page, near.body);
  await slowExpect(panel).toContainText('Or clear it with a Pickaxe and build here 🌱');
  await expect(panel.locator('#tile-panel-title')).toHaveText('Mountains · Homestead 🏡');
  await expect(panel.getByTestId('tile-panel-owner')).toHaveText('Your homestead.');
  await panel.getByTestId('tile-build').tap();
  await expect.poll(async () => (await buildState(page))?.selected).toBe('clear-land');
  await page.getByTestId('build-go').tap();
  await slowExpect(panel).toContainText('Clearing! 🌱');
  expect(errors).toEqual([]);
});
