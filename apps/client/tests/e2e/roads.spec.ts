import { expect, test, type Page } from '@playwright/test';
import { hexDistance, hexKey, hexNeighbors, isWaterTerrain } from '@heartpatch/shared';
import { claimLand, playClaimBattle, selectTile } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Wild Isle roads (#621): a Road reaches two steps past my land, so a claim
 * that was "past your roads" goes through; and taking the road up leaves that
 * land cut off from home, which the map says on the "Some land is cut off!"
 * card. The patch is made through the lobby; the claims are real showdowns.
 */

interface ViewTile {
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  communityId: string | null;
}
interface RoadsView {
  roads: { q: number; r: number; level: number }[];
}
interface Tending {
  tending: { stranded?: { q: number; r: number; since: string; wildAt: string }[] };
}

const roadsDebug = (page: Page) => hook<{ roads: number; loaded: boolean }>(page, 'roads');
const strandedDebug = (page: Page) => hook<{ card: boolean }>(page, 'stranded');

test('a Road reaches a claim two tiles away, and taking it up cuts the land off (#621)', async ({
  browser,
}) => {
  // One signup through the Keeper picker, two real showdowns; CI renders in software.
  test.setTimeout(420_000);
  const page = await newPlayer(browser, uniqueName('road'));
  const lobby = page.getByTestId('lobby');

  // A Wild Isle: the choice is the lobby's.
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByTestId('lobby-patch-type-wild-isle').tap();
  await lobby.getByLabel('Patch name').fill('Road Cove');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByTestId('lobby-wild-chip')).toHaveText('🌊 Wild Isle');
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Road Cove')!.id;
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/items`, { items: { timber: 60, stone: 60 } }))
      .status,
  ).toBe(201);
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => roadsDebug(page)).toMatchObject({ loaded: true, roads: 0 });

  // Land next to home, claimed the ordinary way: the road goes here.
  const mine = await claimLand(page, mapId);
  expect((await api<RoadsView>(page, 'GET', `/maps/${mapId}/roads`)).body.roads).toEqual([]);

  // A tile two steps past it, touching none of my land, on dry ground.
  const view = (await api<{ tiles: ViewTile[] }>(page, 'GET', `/maps/${mapId}/view`)).body.tiles;
  const owned = view.filter((t) => t.ownerUserId !== null);
  const ownedKeys = new Set(owned.map(hexKey));
  const far = view.find(
    (t) =>
      t.ownerUserId === null &&
      t.homeSlot === null &&
      t.communityId === null &&
      !isWaterTerrain(t.terrain) &&
      t.terrain !== 'trading-post' &&
      hexDistance(t, mine) === 2 &&
      hexNeighbors(t).every((n) => !ownedKeys.has(hexKey(n))),
  );
  expect(far, 'a dry tile two steps from the claimed one').toBeDefined();
  const attack = () =>
    api<{ error?: { message: string } }>(page, 'POST', `/maps/${mapId}/attacks`, {
      q: far!.q,
      r: far!.r,
    });

  // Out of reach with no road, and still out of reach with a Path (one step).
  const tooFar = await attack();
  expect(tooFar.status).toBe(403);
  expect(tooFar.body.error?.message).toBe("That's past your roads. Lay a path closer first!");
  // The Build sheet's road cards: a Path first (one step), then a Road (two).
  const lay = async (level: number) => {
    await selectTile(page, mine);
    await page.getByTestId('tile-build').tap();
    await page.locator(`[data-build="road-${String(level)}"]`).tap();
    await page.getByTestId('build-go').tap();
    await expect(page.getByTestId('tile-build-note')).toBeVisible();
  };
  await lay(1);
  await expect.poll(() => roadsDebug(page)).toMatchObject({ roads: 1 });
  expect((await api<RoadsView>(page, 'GET', `/maps/${mapId}/roads`)).body.roads).toMatchObject([
    { q: mine.q, r: mine.r, level: 1 },
  ]);
  expect((await attack()).status).toBe(403);

  // A Road reaches two steps: the claim goes through, and the showdown wins the tile.
  await lay(2);
  expect((await api<RoadsView>(page, 'GET', `/maps/${mapId}/roads`)).body.roads).toMatchObject([
    { q: mine.q, r: mine.r, level: 2 },
  ]);
  await selectTile(page, { q: far!.q, r: far!.r });
  await page.getByTestId('tile-claim').tap();
  await playClaimBattle(page, false);
  await expect
    .poll(async () => {
      const tiles = (await api<{ tiles: ViewTile[] }>(page, 'GET', `/maps/${mapId}/view`)).body
        .tiles;
      return tiles.find((t) => t.q === far!.q && t.r === far!.r)?.ownerUserId ?? null;
    })
    .not.toBeNull();

  // Nothing is cut off while the road joins it up.
  const tending = () => api<Tending>(page, 'GET', `/maps/${mapId}/territory/tending`);
  expect((await tending()).body.tending.stranded ?? []).toEqual([]);
  expect((await strandedDebug(page))?.card).toBe(false);

  // Taking the road up cuts the far tile off from home.
  await selectTile(page, mine);
  await page.getByTestId('road-take-up').tap();
  await page.getByTestId('road-take-up-yes').tap();
  await expect.poll(() => roadsDebug(page)).toMatchObject({ roads: 0 });
  const cut = (await tending()).body.tending.stranded ?? [];
  expect(cut).toMatchObject([{ q: far!.q, r: far!.r }]);
  expect(Date.parse(cut[0]!.wildAt)).toBeGreaterThan(Date.parse(cut[0]!.since));

  // The map tells it on a card the next time it looks (a reload is one such look).
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const card = page.getByTestId('stranded-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Some land is cut off!');
  await expect(card.getByRole('button', { name: 'Show me' })).toBeVisible();
  await expect.poll(() => strandedDebug(page)).toMatchObject({ card: true });
  await page.context().close();
});
