import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { selectTile } from './claim-land.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Homesteads on the map (#199, #242): a joined one glows, a napping one has
 * its own glow, land that's only explored has neither, and the tile header
 * says which. A homestead won back from a capture keeps its joined_at on the
 * server, so no homestead event follows the capture: before the fix the map
 * showed it as plain land until a reload. The capture is played into the map
 * here (dev hook) for a homestead the server still counts as joined.
 */

interface MapDebug {
  id: string;
  viewSeq: number;
  homesteads: number;
  pausedHomesteads: number;
  explored: number;
}

const slowExpect = expect.configure({ timeout: 30_000 });
const mapState = (page: Page) => hook<MapDebug>(page, 'map');
const looks = async (page: Page) => {
  const m = await mapState(page);
  return m ? [m.homesteads, m.pausedHomesteads, m.explored] : null;
};

test('shows joined, napping and explored-only land, and a homestead won back stays one', async ({
  browser,
}) => {
  test.setTimeout(180_000); // CI renders in software
  const page = await newPlayer(browser, uniqueName('glowy'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Glowy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Glowy Patch')!.id;
  // One of each (dev route): joined, napping, and explored but not joined.
  const make = async (joined: boolean | 'napping') => {
    const made = await api<{ q: number; r: number }>(page, 'POST', `/maps/${mapId}/dev/homestead`, {
      terrain: 'mountains',
      joined,
    });
    expect(made.status).toBe(201);
    return made.body;
  };
  const home = await make(true);
  const napping = await make('napping');
  const owned = await make(false);
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // One homestead glow, one napping glow, three sparkles.
  await expect.poll(() => looks(page), { timeout: 30_000 }).toEqual([1, 1, 3]);
  const panel = page.getByTestId('tile-panel');
  const title = panel.locator('#tile-panel-title');
  await selectTile(page, home);
  await slowExpect(title).toHaveText('Mountains · Homestead 🏡');
  await selectTile(page, napping);
  await slowExpect(title).toHaveText('Mountains · Homestead (napping zZ)');
  await selectTile(page, owned);
  await slowExpect(title).toHaveText('Mountains');
  await expect(panel.getByTestId('tile-panel-owner')).toHaveText(
    'Your land, explored ✨. It must touch home to be a homestead.',
  );

  // Won back: the capture's event, for a homestead the server still counts as joined.
  const view = await api<{ tiles: { q: number; r: number; ownerUserId: string | null }[] }>(
    page,
    'GET',
    `/maps/${mapId}/view`,
  );
  const me = view.body.tiles.find((t) => t.q === home.q && t.r === home.r)!.ownerUserId!;
  const seq = (await mapState(page))!.viewSeq;
  await page.evaluate(
    (event) =>
      (
        window as unknown as {
          __heartpatch?: { mapDev?: () => { replay: (e: unknown) => void } };
        }
      ).__heartpatch
        ?.mapDev?.()
        .replay(event),
    {
      v: 1,
      type: 'tile.captured',
      mapId,
      seq: seq + 1,
      at: new Date().toISOString(),
      data: { userId: me, fromUserId: null, q: home.q, r: home.r },
    },
  );
  // The map reads its view again: the glow and the sparkle come back.
  await expect.poll(() => looks(page), { timeout: 30_000 }).toEqual([1, 1, 3]);
  await selectTile(page, home);
  await slowExpect(title).toHaveText('Mountains · Homestead 🏡');
  expect(errors).toEqual([]);
});
