import { expect, test } from './test.js';
import { tapCanvas } from './claim-land.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

// The mini-boss's marker and tile card (#190, 190f). Production has no boss
// out (the boss bag is filled by 234b), so the server's `GET …/boss` is
// answered here; the marker, the card and the tap are the real client.

interface BossMarker {
  name: string;
  known: boolean;
  until: string;
  x: number;
  y: number;
}
interface ViewTile {
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
}

test('a BIG squishy marker shows where it stands, and tapping it opens its card', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await newPlayer(browser, uniqueName('boss'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route('**/api/v1/maps/*/boss', async (route) => {
    const mapId = /\/maps\/([^/]+)\/boss/.exec(route.request().url())?.[1] ?? '';
    const tiles = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/maps/${id}/view`);
      return ((await res.json()) as { tiles: ViewTile[] }).tiles;
    }, mapId);
    const tile = tiles.find((t) => t.ownerUserId === null && t.terrain === 'meadow') ?? tiles[0]!;
    await route.fulfill({
      json: {
        boss: {
          window: { id: '2026-01-05', endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() },
          tile: { q: tile.q, r: tile.r },
          species: null,
          state: 'here',
          triesLeftToday: 2,
        },
      },
    });
  });

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Stomp Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();

  // Unmet: the stand-in name and a "here until" line, never a species.
  await expect
    .poll(async () => (await hook<BossMarker>(page, 'boss'))?.name, { timeout: 30_000 })
    .toBe('A BIG squishy');
  const marker = (await hook<BossMarker>(page, 'boss'))!;
  expect(marker.known).toBe(false);
  expect(marker.until).toMatch(/^here until |^last day!$/);

  // Tap its tile: the card offers the fight with the tries chip.
  const panel = page.getByTestId('tile-panel');
  await expect(async () => {
    const now = (await hook<BossMarker>(page, 'boss'))!;
    await tapCanvas(page, now.x, now.y);
    await expect(panel.getByTestId('boss-card')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(panel.getByTestId('boss-tries')).toHaveText('🍀 2 tries left today');
  await expect(panel.getByTestId('boss-fight')).toHaveText("Let's go!");
  expect(errors).toEqual([]);
});
