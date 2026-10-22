import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { nearestFirst, walkTo } from './explore-walk.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The key hunt and the hidden cellar (#306 PR 2c; owner decision
 * 2026-10-22): winning a Hollow with the map open pops its treasure map,
 * whose "Show me on the map" takes me to the key's glowing tile (mine
 * through the dev route); exploring it shows a glinting spot that digs the
 * key up; then I open the cellar on the square and go down into it: the
 * explore view of a little room in the cave's look, where a spot searched by
 * hand finds something. The treasure map stays in the bag while the hunt is
 * on. Checked through the dev hook.
 */

const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

type Hex = { q: number; r: number };

interface CommunitiesDebug {
  flags: { label: string }[];
  keyHunt: {
    card: string | null;
    block: { kind: 'key' | 'square'; state: string } | null;
    said: string | null;
    glowing: Hex[];
    bag: string[];
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

test('hunts a won Hollow’s cellar key by its treasure map, opens the cellar and searches it (#306)', async ({
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
  // My land reaches my nearest village, the key's tile is mine, and every
  // village tile is one piece short (dev only).
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

  // The joy card comes first; the treasure map waits for it, then pops.
  const card = page.getByTestId('key-map-card');
  const later = page.getByTestId('village-won-later');
  await slowExpect(later).toBeVisible();
  await expect(card).toBeHidden();
  await later.tap();
  // A beat later it shows, and its buttons arm a moment after that.
  await slowExpect(card).toHaveAttribute('data-armed', 'true');
  await expect(card.getByRole('heading')).toHaveText('A treasure map! 🗺️');
  await expect(page.getByTestId('key-map-drawing')).toBeVisible();
  const mine = (await communities(page))!.villages.find((v) => v.id === communityId)!;
  expect(mine.cellar?.state).toBe('hunt');
  const keyTile = mine.cellar!.keyTile!;
  // The key's tile glows (no words), and the map waits in the bag.
  const hunt = (await communities(page))!.keyHunt;
  expect(hunt.glowing).toEqual([keyTile]);
  expect(hunt.bag).toEqual([communityId]);
  // No words over it: only the Hollows' own flags fly.
  expect((await communities(page))!.flags.every((f) => !f.label.includes('🗺️'))).toBe(true);

  // "Show me on the map": the key's tile, whose panel says to explore it.
  await page.getByTestId('key-map-show').tap();
  await expect(card).toBeHidden();
  const go = page.getByTestId('tile-explore');
  await expect(async () => {
    expect(await show(page, keyTile)).toBe(true);
    await expect(page.getByTestId('key-block')).toBeVisible({ timeout: 5_000 });
    await expect(go).toBeEnabled({ timeout: 5_000 });
  }).toPass(slow);
  expect((await communities(page))!.keyHunt.block).toEqual({ kind: 'key', state: 'mine' });

  // Exploring it: one glinting spot past the tile's own, dug up by hand.
  await go.tap();
  await expect.poll(async () => (await exploreState(page))?.open ?? false, slow).toBe(true);
  const keySpot = (await exploreState(page))!.spots.find((s) => s.kind === 'cellar-key')!;
  expect(keySpot).toMatchObject({ tool: null, done: false });
  expect(await walkTo(page, keySpot.index)).toBe(true);
  const dig = page.getByTestId('explore-action');
  await slowExpect(dig).toBeEnabled();
  await expect(dig).toContainText('Dig it up');
  await dig.tap();
  const digging = page.getByTestId('explore-play');
  await slowExpect(digging).toBeVisible();
  for (let i = 0; i < 8 && (await digging.isVisible()); i++) {
    await page.getByTestId('explore-easy').tap();
    await page.waitForTimeout(250);
  }
  await slowExpect(page.getByTestId('explore-key-found')).toHaveText(
    `Open the cellar on ${mine.name}'s square.`,
  );
  await page.getByTestId('explore-yay').tap();
  await page.getByTestId('explore-back').tap();
  await expect.poll(async () => (await exploreState(page))?.open ?? true, slow).toBe(false);
  await expect
    .poll(
      async () =>
        (await communities(page))?.villages.find((v) => v.id === communityId)?.cellar?.state,
      slow,
    )
    .toBe('key');
  // The hunt is over: no glow, no map in the bag.
  await expect.poll(async () => (await communities(page))?.keyHunt.glowing, slow).toEqual([]);
  expect((await communities(page))!.keyHunt.bag).toEqual([]);

  // The square: open the cellar, and down we go.
  const open = page.getByTestId('cellar-open');
  await expect(async () => {
    expect(await show(page, village.square)).toBe(true);
    await expect(open).toBeEnabled({ timeout: 5_000 });
  }).toPass(slow);
  await open.tap();
  await expect.poll(async () => (await exploreState(page))?.open ?? false, slow).toBe(true);
  const inside = (await exploreState(page))!;
  expect(inside.tile?.terrain).toBe('hills');
  expect(inside.spots.length).toBeGreaterThanOrEqual(4);
  expect(inside.spots.every((s) => s.tool === null && !s.done)).toBe(true);
  await expect(page.locator('#explore-title')).toHaveText(/'s cellar 🕯️$/);

  // A spot searched the easy way finds something (a cellar spot is never empty).
  const action = page.getByTestId('explore-action');
  let searched = false;
  for (const spot of nearestFirst(inside.spots, inside.keeper).slice(0, 4)) {
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
  expect(errors).toEqual([]);
});
