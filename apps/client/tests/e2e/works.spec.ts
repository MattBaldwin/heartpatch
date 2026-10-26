import { expect, test } from '@playwright/test';
import { hasWaterNextDoor, hexKey, hexNeighbors, waterKindOf } from '@heartpatch/shared';
import { selectTile } from './claim-land.js';
import { api, hook, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Wild Isle works (#621 W1-10): a Fishing Pier goes up from the Build sheet
 * on a homestead by the water (the Rain Barrel, if the dev route only finds
 * inland ones), and a works whose water isn't next door shows held back with
 * why. The homestead comes from the dev route; the patch is
 * made through the lobby. Asserts on the game's own signals, never pixels.
 */

interface ViewTile {
  q: number;
  r: number;
  terrain: string;
  buildings: { buildingId: string }[];
}

const tileBuild = (page: Parameters<typeof hook>[0]) =>
  hook<{ cards: string[]; mode: string | null }>(page, 'tileBuild');

/** The held-back line each water need reads as (the server's words). */
const HELD_BACK: Record<string, { needs: ('deep' | 'river' | 'lake')[]; line: string }> = {
  'salt-pans': { needs: ['deep'], line: 'Only on the coast 🐚' },
  watermill: { needs: ['river'], line: 'Needs the river 🌊' },
  'river-well': { needs: ['river', 'lake'], line: 'Needs a river or lake next door 💧' },
};

test('a Fishing Pier goes up on a homestead by the water; a works with no water says why (#621)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('pier'));
  const lobby = page.getByTestId('lobby');

  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByTestId('lobby-patch-type-wild-isle').tap();
  await lobby.getByLabel('Patch name').fill('Pier Cove');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByTestId('lobby-wild-chip')).toHaveText('🌊 Wild Isle');
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Pier Cove')!.id;

  // Homesteads next to home until one has water next door (an isle's home is
  // by the sea, so the first nearly always does).
  const view = async () =>
    (await api<{ tiles: ViewTile[] }>(page, 'GET', `/maps/${mapId}/view`)).body.tiles;
  const byWater = (tiles: ViewTile[], at: { q: number; r: number }) =>
    hasWaterNextDoor(at, tiles, [], ['deep', 'river', 'lake'], 0);
  // Homesteads can't touch each other, so the ring runs out after a few: the
  // route then refuses, and the last one made is used, by water or not.
  let homestead: { q: number; r: number } | null = null;
  let wet = false;
  let tiles: ViewTile[] = [];
  for (let i = 0; i < 6 && !wet; i++) {
    const made = await api<{ q: number; r: number }>(page, 'POST', `/maps/${mapId}/dev/homestead`);
    if (made.status !== 201) break;
    homestead = made.body;
    tiles = await view();
    wet = byWater(tiles, made.body);
  }
  expect(homestead, 'a homestead next to home').not.toBeNull();
  const at = homestead!;
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/items`, { items: { timber: 60, stone: 60 } }))
      .status,
  ).toBe(201);

  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForLiveMap(page, mapId);

  await selectTile(page, at);
  await page.getByTestId('tile-build').tap();
  await expect.poll(async () => (await tileBuild(page))?.cards ?? []).toContain('fishing-pier');
  const cards = (await tileBuild(page))!.cards;
  for (const id of ['rain-barrel', 'weather-vane', 'watermill', 'salt-pans', 'river-well']) {
    expect(cards, id).toContain(id);
  }

  // One the water here doesn't suit is shown held back, with why.
  const near = new Set(
    hexNeighbors(at).flatMap((n) => {
      const t = tiles.find((x) => hexKey(x) === hexKey(n));
      const kind = t ? waterKindOf(t.terrain) : null;
      return kind ? [kind] : [];
    }),
  );
  const held = Object.entries(HELD_BACK).find(([, h]) => !h.needs.some((k) => near.has(k)));
  if (held) {
    const [id, { line }] = held;
    const card = page.locator(`[data-build="${id}"]`);
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    // A held-back card is aria-disabled but still taps, to say why (#242 3b-1).
    await card.tap({ force: true });
    await expect(page.getByTestId('build-detail')).toContainText(line);
  }

  // By the water the pier goes up; inland it says why, and the Rain Barrel
  // (which needs no water) goes up instead.
  const pick = wet ? 'fishing-pier' : 'rain-barrel';
  if (!wet) {
    await page.locator('[data-build="fishing-pier"]').tap({ force: true });
    await expect(page.getByTestId('build-detail')).toContainText('Needs water next door 💧');
  }
  await page.locator(`[data-build="${pick}"]`).tap();
  await expect(page.getByTestId('build-go')).toBeEnabled();
  await page.getByTestId('build-go').tap();
  const name = wet ? 'Fishing Pier' : 'Rain Barrel';
  await expect(page.getByTestId('tile-build-note')).toHaveText(
    `Built! Your ${name} is getting to work 🔨`,
  );
  await expect
    .poll(async () => {
      const t = (await view()).find((x) => x.q === at.q && x.r === at.r);
      return t?.buildings.map((b) => b.buildingId) ?? [];
    })
    .toEqual([pick]);
  await page.context().close();
});
