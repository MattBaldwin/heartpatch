import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { nearestFirst, walkTo } from './explore-walk.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The key hunt and the hidden cellar (#306 PR 2c): winning a village with
 * the map open pops "A map to the key!", whose "Show me on the map" takes
 * me to the key's flagged tile; I dig the key up there (my land reaches it
 * through the dev route), open the cellar on the square, and go down into it:
 * a stone vault with a row of chests and the big chest in the middle (#306,
 * owner 2026-10-22). A small chest opened by hand pops its lid and finds
 * something; the big chest waits for the little ones. Checked through the
 * dev hook.
 */

const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

type Hex = { q: number; r: number };

interface CommunitiesDebug {
  keyHunt: {
    card: string | null;
    block: { kind: 'key' | 'square'; state: string; canDig: boolean } | null;
    said: string | null;
  };
  villages: {
    id: string;
    name: string;
    ownerUserId: string | null;
    cellar: { state: string; keyTile?: Hex } | null;
  }[];
}

interface ExploreDebug {
  open: boolean;
  tile: { terrain: string } | null;
  progress: { searched: number; total: number } | null;
  keeper: { x: number; z: number };
  spots: {
    index: number;
    kind: string;
    tool: string | null;
    done: boolean;
    x: number;
    z: number;
  }[];
  scene: { cellar: { chests: number; open: number; moments: number } | null } | null;
}

interface MapView {
  communities?: { id: string; name: string; square: Hex; tiles: Hex[] }[];
}

type Hooks = { __heartpatch?: { mapDev?: () => { show(q: number, r: number): boolean } } };

const communities = (page: Page) => hook<CommunitiesDebug>(page, 'communities');
const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const show = (page: Page, at: Hex) =>
  page.evaluate(
    ({ q, r }) => (window as unknown as Hooks).__heartpatch?.mapDev?.().show(q, r) ?? false,
    at,
  );

test('hunts a won village’s cellar key, opens the cellar and searches it (#306 PR 2c)', async ({
  browser,
}) => {
  test.setTimeout(300_000); // a patch, a win, the map, then the cellar; CI renders in software
  const page = await newPlayer(browser, uniqueName('digger'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Cellar Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Cellar Patch')!.id;
  // My land reaches my nearest village and its key, and every village tile
  // is one piece short (dev only).
  expect((await api(page, 'POST', `/maps/${mapId}/dev/hollowed-reach`)).status).toBe(201);
  const almost = await api<{ id: string }>(page, 'POST', `/maps/${mapId}/dev/village-almost`);
  expect(almost.status, JSON.stringify(almost.body)).toBe(201);
  const communityId = almost.body.id;
  const reach = await api(page, 'POST', `/maps/${mapId}/dev/key-reach`, { communityId });
  expect(reach.status, JSON.stringify(reach.body)).toBe(201);
  const view = await api<MapView>(page, 'GET', `/maps/${mapId}/view`);
  const village = view.body.communities!.find((c) => c.id === communityId)!;

  await visitPatch(lobby);
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Win it with the map open: each tile's last piece (the restore route).
  for (const tile of village.tiles) {
    const sheet = await api<{ tile: { piecesDone: number } }>(
      page,
      'GET',
      `/maps/${mapId}/communities/${communityId}/restore?q=${String(tile.q)}&r=${String(tile.r)}`,
    );
    const done = await api(page, 'POST', `/maps/${mapId}/communities/${communityId}/restore`, {
      ...tile,
      piecesDone: sheet.body.tile.piecesDone,
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  }

  // The joy card comes first; the map to the key waits for it, then pops.
  const card = page.getByTestId('key-map-card');
  const later = page.getByTestId('village-won-later');
  await slowExpect(later).toBeVisible();
  await expect(card).toBeHidden();
  await later.tap();
  // A beat later it shows, and its buttons arm a moment after that.
  await slowExpect(card).toHaveAttribute('data-armed', 'true');
  await expect(card.getByRole('heading')).toHaveText('A map to the key! 🗺️');
  const mine = (await communities(page))!.villages.find((v) => v.id === communityId)!;
  expect(mine.cellar?.state).toBe('hunt');
  const keyTile = mine.cellar!.keyTile!;

  // "Show me on the map": the key's tile and its panel, where I can dig.
  await page.getByTestId('key-map-show').tap();
  await expect(card).toBeHidden();
  // Its flag stands in the flag room (shown wherever the panel and other flags leave room).
  await expect(page.getByTestId('key-flag')).toHaveText('🗺️ The cellar key is hidden here');
  const dig = page.getByTestId('key-dig');
  await expect(async () => {
    expect(await show(page, keyTile)).toBe(true);
    await expect(dig).toBeEnabled({ timeout: 5_000 });
  }).toPass(slow);
  await dig.tap();
  await slowExpect(page.getByTestId('key-said')).toHaveText(
    `You found the cellar key! 🔑 Open the cellar on ${mine.name}'s square.`,
  );
  await expect
    .poll(
      async () =>
        (await communities(page))?.villages.find((v) => v.id === communityId)?.cellar?.state,
      slow,
    )
    .toBe('key');
  await slowExpect(page.getByTestId('key-flag')).toHaveCount(0);

  // The square: open the cellar, and down we go.
  const open = page.getByTestId('cellar-open');
  await expect(async () => {
    expect(await show(page, village.square)).toBe(true);
    await expect(open).toBeEnabled({ timeout: 5_000 });
  }).toPass(slow);
  await open.tap();
  await expect.poll(async () => (await exploreState(page))?.open ?? false, slow).toBe(true);
  const inside = (await exploreState(page))!;
  expect(inside.tile?.terrain).toBe('cellar');
  const small = inside.spots.filter((s) => s.kind === 'chest');
  expect(small.length).toBeGreaterThanOrEqual(4);
  expect(inside.spots.at(-1)?.kind).toBe('big-chest');
  expect(inside.spots.every((s) => s.tool === null && !s.done)).toBe(true);
  expect(inside.scene?.cellar).toMatchObject({ chests: small.length + 1, open: 0 });
  await expect(page.locator('#explore-title')).toHaveText(/'s cellar\s🕯️$/);

  // A chest opened the easy way finds something (a small chest is never empty).
  const action = page.getByTestId('explore-action');
  await expect(action).not.toHaveText(/Lift/);
  let searched = false;
  for (const spot of nearestFirst(small, inside.keeper).slice(0, 4)) {
    if (!(await walkTo(page, spot.index))) continue;
    await slowExpect(action).toBeEnabled();
    await action.tap();
    const play = page.getByTestId('explore-play');
    await slowExpect(play).toBeVisible();
    for (let i = 0; i < 8 && (await play.isVisible()); i++) {
      await page.getByTestId('explore-easy').tap();
      await page.waitForTimeout(250);
    }
    await expect
      .poll(
        async () =>
          (await exploreState(page))?.spots.find((s) => s.index === spot.index)?.done ?? false,
        slow,
      )
      .toBe(true);
    searched = true;
    break;
  }
  expect(searched).toBe(true);
  expect((await exploreState(page))?.progress?.searched).toBe(1);
  // Its lid popped open here.
  expect((await exploreState(page))?.scene?.cellar).toMatchObject({ open: 1, moments: 1 });
  const yay = page.getByTestId('explore-yay');
  if (await yay.isVisible()) await yay.tap();

  // The big chest waits until every little one is open.
  const big = inside.spots.at(-1)!;
  expect(await walkTo(page, big.index)).toBe(true);
  await slowExpect(action).toHaveText(/Open/);
  await action.tap();
  const play = page.getByTestId('explore-play');
  await slowExpect(play).toBeVisible();
  for (let i = 0; i < 8 && (await play.isVisible()); i++) {
    await page.getByTestId('explore-easy').tap();
    await page.waitForTimeout(250);
  }
  await slowExpect(page.getByTestId('explore-note')).toHaveText('Open the little chests first! 🗝️');
  expect((await exploreState(page))?.spots.at(-1)?.done).toBe(false);
  expect(errors).toEqual([]);
});
