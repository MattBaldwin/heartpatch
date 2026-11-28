import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
import { draws, hook, idle, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { touch } from './touch.js';

/** The open map as drawn, from the dev hook (src/map/map-screen.ts `MapDebug`). */
interface MapDebug {
  id: string;
  viewSeq: number;
  tiles: number;
  tileMeshes: number;
  tinted: number;
  borderMeshes: number;
  homes: number;
  claimedHomes: number;
  selected: string | null;
  props: number;
  propKinds: number;
  mutedTiles: number;
  ambient: 'live' | 'still' | 'off';
  detail: 'near' | 'far';
  openHomes: { key: string; x: number; y: number }[];
  drawCalls: number;
  activeTriangles: number;
  /** Dressed for Halloween (the season by the map's date on the game clock, #583). */
  halloween: boolean;
  /** Builds since the map was opened (a reseason rebuilds it, #583). */
  builds: number;
  /** Christmas snow (#37): how far the first snow has faded in, null out of season. */
  snow?: number | null;
  motes?: Record<string, number>;
  /** Twinkle Lights (#37 2a): lit tiles, bulbs drawn, and whether they're lit and twinkling. */
  lightsTiles?: number;
  bulbs?: number;
  bulbsLit?: boolean;
  bulbsTwinkle?: boolean;
  /** A Clockwork Isle's frost tint (#874). */
  frost?: boolean;
}

/**
 * The map's render budget (#318), a little over what a fresh 6-seat patch
 * (radius 16) measured: 54 draw calls; 1.13-1.22M triangles up close
 * (it varies with the map's seed), about 550k zoomed out, where tiles and
 * props draw at low detail. Zooming out mustn't cost draw calls.
 */
const MAP_BUDGET = {
  drawCalls: 75,
  nearTriangles: 1_300_000,
  farTriangles: 620_000,
} as const;

/**
 * Wild Isle's budget (#621 W1-4, TUNE), on the radius-18 test island (the
 * dev page `/island.html`, no server): the plan's 82 draw calls. Its tiles
 * are about a 6-seat Cozy patch's (the ocean is one sea, never tiles), so
 * triangles get Cozy's budget plus a little for the coast's shells and
 * driftwood: measured 64 draw calls, 1.17M triangles up close, 587k far.
 */
const WILD_BUDGET = {
  drawCalls: 82,
  nearTriangles: 1_400_000,
  farTriangles: 680_000,
} as const;

/**
 * Clockwork Isle's budget (#874 C4, plan §5, TUNE): Wild Isle's 82 plus its
 * own layers at their worst, every one a single thin-instanced mesh: wire
 * posts, wires (lit and dark share one mesh, tinted per instance), rails,
 * the wind's arrows and its wash. The frost is a terrain-plugin uniform (no
 * draw call). Measured on `/island.html?patch=clockwork` with sample lines
 * on every Keeper's land and the wind shown.
 */
const CLOCKWORK_BUDGET = {
  drawCalls: 88,
  nearTriangles: 1_400_000,
  farTriangles: 680_000,
} as const;

/** The dev island page's hook (src/map/gallery/island-gallery-main.ts). */
type IslandHooks = Window & {
  __islandMap?: {
    ready: () => boolean;
    stats: () => MapDebug | null;
    lines: () => { wires: number; litWires: number; rails: number } | null;
    wind: () => { shown: boolean; tiles: readonly number[]; moving: boolean } | null;
    weather: () => {
      clouds: number;
      rain: number;
      fog: number;
      mode: string;
      placed: number;
    } | null;
    clock: () => number | null;
  };
};

function mapState(page: Page): Promise<MapDebug | null> {
  return hook<MapDebug>(page, 'map');
}

/** A touch tap on the canvas as pointer events (the same in WebKit and Chromium; see smoke.spec.ts). */
async function tapCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('#game')!;
      for (const type of ['pointerdown', 'pointerup']) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { x, y },
  );
}

async function openPatch(page: Page, name: string): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: new RegExp(name) }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText(name);
}

test('draws a patch, shows tile info on tap, and follows land changes live', async ({
  browser,
}) => {
  // Two players, shader compiles; CI renders in software. It ran 1.9-2.0 min on iPad CI, so 120 s
  // ran out at the friend's join (#429).
  test.setTimeout(240_000);
  const ownerName = uniqueName('own');
  const friendName = uniqueName('pal');

  // The owner makes a patch and visits it.
  const owner = await newPlayer(browser, ownerName);
  const errors: string[] = [];
  owner.on('pageerror', (err) => errors.push(err.message));
  const ownerLobby = owner.getByTestId('lobby');
  await ownerLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await ownerLobby.getByLabel('Patch name').fill('Moonlit Patch');
  await ownerLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await ownerLobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  await visitPatch(ownerLobby);
  await expect(ownerLobby).toBeHidden();

  // The full 6-seat map (#318): 817 tiles in a handful of instanced meshes,
  // the owner's home ring tinted, one claimed home base of six.
  await expect
    .poll(() => mapState(owner), { timeout: 30_000 })
    .toMatchObject({
      tiles: 817,
      tinted: 7,
      borderMeshes: 1,
      homes: 6,
      claimedHomes: 1,
      selected: null,
    });
  const drawn = (await mapState(owner))!;
  // 9 terrain looks (trading posts too, #269) plus home tiles, however many tiles.
  expect(drawn.tileMeshes).toBeLessThanOrEqual(10);
  await expect(owner.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForLiveMap(owner);

  // The camera starts on the owner's Heart Seed: tapping the middle shows it.
  const box = (await owner.locator('#game').boundingBox())!;
  await tapCanvas(owner, box.width / 2, box.height / 2);
  const panel = owner.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  await expect(owner.getByTestId('tile-panel-owner')).toHaveText(
    'Your home base. Nobody can ever take it!',
  );
  await expect(panel).not.toContainText(/claim|challenge/i);
  expect((await mapState(owner))?.selected).not.toBeNull();
  await panel.getByRole('button', { name: 'Close' }).tap();
  await expect(panel).toBeHidden();
  expect((await mapState(owner))?.selected).toBeNull();

  // A friend asks to join; the owner approves from the lobby while the map
  // stays open behind it. The new home base is tinted without a reload.
  const friend = await newPlayer(browser, friendName);
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code);
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-waiting')).toBeVisible();

  await owner.getByTestId('lobby-open').tap();
  await openPatchDetail(owner, 'Moonlit Patch');
  await ownerLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-notice')).toContainText(`${friendName} joined`);
  await expect
    .poll(() => mapState(owner), { timeout: 15_000 })
    .toMatchObject({ tinted: 14, claimedHomes: 2 });

  // The friend's waiting row turns into the patch by itself (#145); they see both home bases.
  await openPatch(friend, 'Moonlit Patch');
  await expect
    .poll(() => mapState(friend), { timeout: 30_000 })
    .toMatchObject({ tiles: 817, tinted: 14, borderMeshes: 2, claimedHomes: 2 });

  // The legend (#278): the name pill opens a card saying whose land is
  // whose, by colour, icon and line; a tap on the map closes it.
  await friend.getByTestId('map-legend-button').tap();
  const legend = friend.getByTestId('map-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText(`${ownerName}'s land`);
  await expect(legend).toContainText('Your land');
  const friendBox = (await friend.locator('#game').boundingBox())!;
  await tapCanvas(friend, friendBox.width / 2, friendBox.height * 0.7);
  await expect(legend).toBeHidden();

  // The owner removes the friend: the friend's map closes with a kind note,
  // and the owner's map un-tints their land live.
  const friendRow = ownerLobby
    .getByTestId('lobby-members')
    .getByRole('listitem')
    .filter({ hasText: friendName });
  await friendRow.getByRole('button', { name: 'Remove' }).tap();
  await ownerLobby.getByRole('button', { name: 'Remove', exact: true }).tap();
  await expect
    .poll(() => mapState(owner), { timeout: 15_000 })
    .toMatchObject({ tinted: 7, claimedHomes: 1 });
  await expect.poll(() => mapState(friend), { timeout: 15_000 }).toBeNull();
  await expect(friendLobby).toBeVisible();
  await expect(friend.getByTestId('map-hud')).toBeHidden();

  expect(errors).toEqual([]);
  await owner.context().close();
  await friend.context().close();
});

/** Opens a patch's lobby card (not the map) from the patch list. */
async function openPatchDetail(page: Page, name: string): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: new RegExp(name) }).tap();
  await expect(lobby.getByRole('heading', { name })).toBeVisible();
}

test('dresses the land, mutes wild land, and keeps ambient life calm', async ({ browser }) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const page = await newPlayer(browser, uniqueName('dress'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // A shader that doesn't compile only logs: catch it here.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /shader|effect|compile/i.test(msg.text()))
      errors.push(msg.text());
  });
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Leafy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Every terrain is dressed (one mesh per prop kind), and only the player's
  // home ring and Juniper's Gap are in full colour: the rest is wild.
  // The map's debug view is null for a moment after the scene is ready (#429).
  await expect
    .poll(async () => (await mapState(page))?.props ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(1000);
  const drawn = (await mapState(page))!;
  expect(drawn.props).toBeGreaterThan(1000);
  expect(drawn.propKinds).toBeGreaterThanOrEqual(18);
  expect(drawn.mutedTiles).toBeGreaterThan(700);
  expect(drawn.mutedTiles).toBeLessThan(817 - 7);

  // Ambient life runs (or switched itself off on a renderer too slow for it,
  // as CI's software one can be)...
  expect(['live', 'off']).toContain(drawn.ambient);
  // ...and with reduced motion nothing moves, so the map draws nothing at all.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(async () => (await mapState(page))?.ambient, { timeout: 15_000 })
    .toMatch(/^(still|off)$/);
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
  const before = await draws(page);
  await page.waitForTimeout(1500);
  expect(await draws(page)).toBe(before);
  await page.emulateMedia({ reducedMotion: null });

  expect(errors).toEqual([]);
  await page.context().close();
});

test('dresses the map for the server’s season, not the phone’s date (#583)', async ({
  browser,
}) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const page = await newPlayer(browser, uniqueName('clock'));
  // The phone's calendar says Nov 20, past the Halloween window; the server's
  // game clock (map-local 2026-10-20, playwright.config.ts) is inside it. A cold start: the map's
  // first build must already be dressed by the server's date.
  await page.clock.setFixedTime(new Date('2026-11-20T12:00:00'));
  await page.reload();
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({
    timeout: 15_000,
  });
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Pumpkin Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // The map's debug view is null for a moment after the scene is ready (#429).
  await expect.poll(async () => (await mapState(page))?.halloween, { timeout: 30_000 }).toBe(true);
  // Once the bag has settled (its sync would reseason a map dressed wrong),
  // the first build is still the only one: it was dressed right, not redone.
  await expect
    .poll(async () => (await hook<{ mapId: string }>(page, 'inventory'))?.mapId, {
      timeout: 30_000,
    })
    .toBeTruthy();
  await page.waitForTimeout(1000);
  expect((await mapState(page))?.builds).toBe(1);
  await page.context().close();
});

test('keeps the map in its draw-call and triangle budget, up close and zoomed out (#318)', async ({
  browser,
}) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const page = await newPlayer(browser, uniqueName('bud'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Budget Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();

  // Up close, once every mesh's shaders are ready and drawing.
  await expect
    .poll(async () => (await mapState(page))?.drawCalls ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(40);
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
  const near = (await mapState(page))!;
  expect(near.detail).toBe('near');
  expect(near.drawCalls).toBeLessThanOrEqual(MAP_BUDGET.drawCalls);
  expect(near.activeTriangles).toBeLessThanOrEqual(MAP_BUDGET.nearTriangles);

  // Pinch in, again and again, to the farthest zoom: low detail, no more draw calls.
  const box = (await page.locator('#game').boundingBox())!;
  const mid = { x: box.width / 2, y: box.height / 2 };
  const reach = Math.min(box.width, box.height) / 3;
  for (let i = 0; i < 4; i++) {
    await touch(
      page,
      Array.from({ length: 9 }, (_, k) => {
        const d = reach * (1 - k / 9);
        return { 1: { x: mid.x - d, y: mid.y }, 2: { x: mid.x + d, y: mid.y } };
      }),
    );
  }
  await expect.poll(async () => (await mapState(page))?.detail, { timeout: 15_000 }).toBe('far');
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
  const far = (await mapState(page))!;
  // The measured numbers, in the report, for tuning the budget.
  test.info().annotations.push({
    type: 'map budget',
    description: JSON.stringify({
      near: { drawCalls: near.drawCalls, triangles: near.activeTriangles },
      far: { drawCalls: far.drawCalls, triangles: far.activeTriangles },
    }),
  });
  expect(far.drawCalls).toBeLessThanOrEqual(near.drawCalls);
  expect(far.activeTriangles).toBeLessThanOrEqual(MAP_BUDGET.farTriangles);
});

test('an open home says it is saved for the next Keeper, and offers nothing to take (#318)', async ({
  browser,
}) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const page = await newPlayer(browser, uniqueName('open'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Roomy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForLiveMap(page);

  // Zoom out until an open home is on screen, then tap its middle.
  const box = (await page.locator('#game').boundingBox())!;
  const mid = { x: box.width / 2, y: box.height / 2 };
  const reach = Math.min(box.width, box.height) / 3;
  const onScreen = async () =>
    ((await mapState(page))?.openHomes ?? []).filter(
      (h) => h.x > 40 && h.x < box.width - 40 && h.y > 160 && h.y < box.height - 160,
    );
  for (let i = 0; i < 8 && (await onScreen()).length === 0; i++) {
    await touch(
      page,
      Array.from({ length: 9 }, (_, k) => {
        const d = reach * (1 - k / 9);
        return { 1: { x: mid.x - d, y: mid.y }, 2: { x: mid.x + d, y: mid.y } };
      }),
    );
    await expect.poll(() => idle(page), { timeout: 15_000 }).toBe(true);
  }
  const [open] = await onScreen();
  expect(open, 'an open home on screen').toBeDefined();
  await tapCanvas(page, open!.x, open!.y);
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('tile-panel-owner')).toHaveText(
    'A cozy home, saved for the next Keeper who joins! ✨',
  );
  await expect(panel.getByRole('button', { name: /Claim|Challenge/ })).toHaveCount(0);
});

/**
 * Christmas's ceilings (#37 plan §1): the map 78 draw calls, Wild Isle 85,
 * for the whole season's look (snow, lights, the tree). Snow itself adds none:
 * it is per-instance colour and a terrain-plugin uniform, and snowfall takes
 * the place of pollen, leaves and fireflies.
 */
const CHRISTMAS_CEILING = { cozy: 78, wild: 85 } as const;

/** The dev island page's map stats once it has drawn (`/island.html?<query>`). */
async function islandStats(page: Page, query: string): Promise<MapDebug> {
  await page.goto(`/island.html?${query}`);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const hook = (window as IslandHooks).__islandMap;
          return hook?.ready() === true ? (hook.stats()?.drawCalls ?? 0) : 0;
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(30);
  const stats = await page.evaluate(() => (window as IslandHooks).__islandMap?.stats() ?? null);
  if (!stats) throw new Error('the island page drew no map');
  return stats;
}

test('snows on every patch inside the Christmas ceilings, day and night (#37)', async ({
  page,
}) => {
  test.setTimeout(300_000); // shader compiles; CI renders in software
  const measure = (query: string) => islandStats(page, query);
  const seen: Record<string, number> = {};
  for (const patch of ['cozy', 'wild'] as const) {
    for (const tier of ['high', 'medium'] as const) {
      const today = await measure(`patch=${patch}&tier=${tier}`);
      expect(today.snow ?? null).toBeNull();
      for (const night of [false, true]) {
        const snowy = await measure(
          `patch=${patch}&tier=${tier}&season=christmas&snow=1${night ? '&night=1' : ''}`,
        );
        const label = `${patch} ${tier} ${night ? 'night' : 'day'}`;
        seen[label] = snowy.drawCalls;
        expect(snowy.snow, label).toBe(1);
        expect(snowy.motes?.['snow'] ?? 0, label).toBeGreaterThan(0);
        expect(snowy.motes?.['pollen'] ?? 0, label).toBe(0);
        expect(snowy.drawCalls, label).toBeLessThanOrEqual(CHRISTMAS_CEILING[patch]);
        // The snow adds no draw call over today's map beyond its one mote layer (the gallery's
        // today stands still, so it draws no pollen, leaves or fireflies, which snowfall replaces).
        expect(snowy.drawCalls, label).toBeLessThanOrEqual(today.drawCalls + 1);
      }
    }
  }
  test.info().annotations.push({ type: 'christmas draw calls', description: JSON.stringify(seen) });
});

/** The most bulbs the map draws (`CHRISTMAS.bulbs.cap`, #37 2a). */
const BULB_CAP = 600;

test('strings Twinkle Lights inside the Christmas ceilings, lit only on December nights (#37 2a)', async ({
  page,
}) => {
  test.setTimeout(300_000); // shader compiles; CI renders in software
  // A bulb shader that fails to compile draws nothing but still counts as a drawn map.
  const shaderErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /compil/i.test(m.text())) shaderErrors.push(m.text().slice(0, 200));
  });
  const seen: Record<string, number> = {};
  for (const patch of ['cozy', 'wild'] as const) {
    const bare = await islandStats(
      page,
      `patch=${patch}&tier=medium&season=christmas&built=1&night=1`,
    );
    expect(bare.bulbs ?? 0).toBe(0);
    // A busy patch: four Keepers with Twinkle Lights on four tiles each (twice the per-Keeper cap).
    for (const night of [false, true]) {
      const label = `${patch} ${night ? 'night' : 'day'}`;
      const lit = await islandStats(
        page,
        `patch=${patch}&tier=medium&season=christmas&lights=4&built=1${night ? '&night=1' : ''}`,
      );
      seen[label] = lit.drawCalls;
      expect(lit.lightsTiles ?? 0, label).toBeGreaterThan(0);
      expect(lit.bulbs ?? 0, label).toBeGreaterThan(0);
      expect(lit.bulbs ?? 0, label).toBeLessThanOrEqual(BULB_CAP);
      // Lit at night, coloured glass by day; steady under reduced motion (the gallery's default).
      expect(lit.bulbsLit, label).toBe(night);
      expect(lit.bulbsTwinkle, label).toBe(false);
      expect(lit.drawCalls, label).toBeLessThanOrEqual(CHRISTMAS_CEILING[patch]);
      // One draw call for every bulb, plus the Twinkle Lights' post (one building look).
      expect(lit.drawCalls, label).toBeLessThanOrEqual(bare.drawCalls + 2);
    }
  }
  // With motion on, the lit bulbs twinkle (on the GPU clock).
  const live = await islandStats(
    page,
    'patch=cozy&tier=medium&season=christmas&lights=1&night=1&motion=1',
  );
  expect(live.bulbsLit).toBe(true);
  expect(live.bulbsTwinkle).toBe(true);
  // Out of December a Twinkle Lights already built stays, unlit.
  const after = await islandStats(page, 'patch=cozy&tier=medium&lights=1&night=1');
  expect(after.bulbs ?? 0).toBeGreaterThan(0);
  expect(after.bulbsLit).toBe(false);
  expect(shaderErrors).toEqual([]);
  test.info().annotations.push({ type: 'twinkle draw calls', description: JSON.stringify(seen) });
});

test('keeps a Wild Isle in its draw-call and triangle budget, up close and zoomed out (#621)', async ({
  page,
}) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const measure = async (query: string) => {
    await page.goto(`/island.html?tier=high&${query}`);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const hook = (window as IslandHooks).__islandMap;
            return hook?.ready() === true ? (hook.stats()?.drawCalls ?? 0) : 0;
          }),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(40);
    const stats = await page.evaluate(() => (window as IslandHooks).__islandMap?.stats() ?? null);
    if (!stats) throw new Error('the island page drew no map');
    return stats;
  };
  const near = await measure('patch=wild');
  expect(near.detail).toBe('near');
  // The whole radius-18 map, the ocean drawn as one sea (no ocean tile instances).
  expect(near.tiles).toBe(1027);
  expect(near.drawCalls).toBeLessThanOrEqual(WILD_BUDGET.drawCalls);
  expect(near.activeTriangles).toBeLessThanOrEqual(WILD_BUDGET.nearTriangles);
  const far = await measure('patch=wild&far=1');
  expect(far.detail).toBe('far');
  test.info().annotations.push({
    type: 'wild isle budget',
    description: JSON.stringify({
      near: { drawCalls: near.drawCalls, triangles: near.activeTriangles },
      far: { drawCalls: far.drawCalls, triangles: far.activeTriangles },
    }),
  });
  expect(far.drawCalls).toBeLessThanOrEqual(near.drawCalls);
  expect(far.activeTriangles).toBeLessThanOrEqual(WILD_BUDGET.farTriangles);
});

test('draws a Wild Isle storm inside the draw-call budget; low keeps a lighter storm rain; reduced motion holds still (#621)', async ({
  page,
}) => {
  test.setTimeout(150_000); // shader compiles; CI renders in software
  const look = async (query: string) => {
    await page.goto(`/island.html?${query}`);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const hook = (window as IslandHooks).__islandMap;
            return hook?.ready() === true ? (hook.weather()?.placed ?? 0) : 0;
          }),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
    return page.evaluate(() => {
      const hook = (window as IslandHooks).__islandMap;
      return { stats: hook?.stats() ?? null, weather: hook?.weather() ?? null };
    });
  };

  // High tier, a storm: clouds and rain, still inside the Wild Isle budget (5 weather draw calls: clouds, shadows, rain, bolts, fog; plus the glow pass round the bolts).
  const storm = await look('tier=high&patch=wild&weather=storm');
  expect(storm.weather?.clouds).toBeGreaterThan(0);
  expect(storm.weather?.rain).toBeGreaterThan(0);
  expect(storm.stats?.drawCalls).toBeLessThanOrEqual(WILD_BUDGET.drawCalls);

  // Fog draws fog only.
  const fog = await look('tier=high&patch=wild&weather=fog');
  expect(fog.weather?.fog).toBeGreaterThan(0);
  expect(fog.weather?.rain).toBe(0);
  expect(fog.stats?.drawCalls).toBeLessThanOrEqual(WILD_BUDGET.drawCalls);

  // The low tier drops plain rain but a storm keeps a lighter one: fewer streaks than the high tier.
  const low = await look('tier=low&patch=wild&weather=storm');
  expect(low.weather?.mode).toBe('off');
  expect(low.weather?.clouds).toBeGreaterThan(0);
  expect(low.weather?.rain).toBeGreaterThan(0);
  expect(low.weather?.rain).toBeLessThan(storm.weather?.rain ?? 0);
  const lowRain = await look('tier=low&patch=wild&weather=rain');
  expect(lowRain.weather?.rain).toBe(0);

  // Reduced motion (the gallery's setting) holds the weather still: the clock never moves.
  await look('tier=high&patch=wild&weather=storm');
  const before = await page.evaluate(() => (window as IslandHooks).__islandMap?.clock() ?? null);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => (window as IslandHooks).__islandMap?.clock() ?? null);
  expect(storm.weather?.mode).toBe('still');
  expect(after).toBe(before);

  // A cozy patch has no weather layer at all.
  await page.goto('/island.html?tier=high&patch=cozy&weather=storm');
  await expect
    .poll(() => page.evaluate(() => (window as IslandHooks).__islandMap?.ready() === true), {
      timeout: 60_000,
    })
    .toBe(true);
  expect(
    await page.evaluate(() => (window as IslandHooks).__islandMap?.weather()?.placed ?? 0),
  ).toBe(0);
});

test('a real tap on the weather chip opens the Forecast sheet, and the top bar fits a 375pt phone (#621)', async ({
  browser,
}) => {
  test.setTimeout(180_000); // one signup through the Keeper picker, 40 s of rain; CI renders in software
  const page = await newPlayer(browser, uniqueName('sky'));
  // The high tier, pinned: software rendering would drop to low (no rain) on its own.
  await page.goto('/?tier=high');
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByTestId('lobby-patch-type-wild-isle').tap();
  await lobby.getByLabel('Patch name').fill('Drizzle Cove');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();

  const chip = page.getByTestId('weather-chip');
  await expect(chip).toBeVisible({ timeout: 30_000 });
  // Nothing lies over the chip (the HUD is pointer-events: none, the legend's
  // whole-row tap sits under it): the finger lands on the chip itself.
  const hit = await chip.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top !== null && node.contains(top);
  });
  expect(hit).toBe(true);
  // Rain over my home, an hour in (the server's clock), read when the sheet opens.
  const mapId = (await mapState(page))!.id;
  const sky = await page.request.get(`/api/v1/maps/${mapId}/weather`);
  const serverTime = Date.parse(((await sky.json()) as { serverTime: string }).serverTime);
  const rained = await page.request.post(`/api/v1/maps/${mapId}/dev/weather`, {
    data: { kind: 'rain', hours: 6, at: new Date(serverTime - 3_600_000).toISOString() },
    headers: { 'x-requested-with': 'heartpatch' },
  });
  expect(rained.ok()).toBe(true);
  const opened = Date.now();
  // A real click (no force, no dispatched event): the sheet opens, the legend stays shut.
  await chip.click();
  await expect(page.getByTestId('weather-sheet')).toBeVisible();
  await expect(page.getByTestId('map-legend-button')).not.toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('weather-close').click();
  await expect(page.getByTestId('weather-sheet')).toBeHidden();

  // The rain keeps falling for the whole front: a slow (software-rendered)
  // device's ambient goes off a few seconds in, and the streaks hold still
  // then rather than vanish (#621 round 3).
  const rain = () =>
    page.evaluate(
      () =>
        (
          window as Window & { __heartpatch?: { weather?: () => { rain: number } } }
        ).__heartpatch?.weather?.().rain ?? 0,
    );
  await expect.poll(rain, { timeout: 30_000 }).toBeGreaterThan(0);
  for (const at of [15_000, 40_000]) {
    await expect.poll(() => Date.now() - opened, { timeout: 60_000 }).toBeGreaterThan(at);
    expect(await rain(), `rain ${String(at / 1000)}s in`).toBeGreaterThan(0);
  }

  // iPhone SE width: "My patches" ends before the 🐾 button begins.
  await page.setViewportSize({ width: 375, height: 667 });
  const gap = await page.evaluate(() => {
    const patches = document.querySelector('.lobby-open')?.getBoundingClientRect();
    const paw = document.querySelector('.squishies-open-map')?.getBoundingClientRect();
    return patches && paw ? paw.left - patches.right : null;
  });
  expect(gap).not.toBeNull();
  expect(gap!).toBeGreaterThanOrEqual(4);
  await page.context().close();
});

test('keeps a Clockwork Isle with wires, rails, wind and frost in its budget (#874)', async ({
  page,
}) => {
  test.setTimeout(240_000); // shader compiles; CI renders in software
  const shaderErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /shader|compile|link/i.test(msg.text())) {
      shaderErrors.push(msg.text());
    }
  });
  const seen: Record<string, { drawCalls: number; triangles: number }> = {};
  const measure = async (query: string) => {
    const stats = await islandStats(page, `tier=high&${query}`);
    seen[query] = { drawCalls: stats.drawCalls, triangles: stats.activeTriangles };
    return stats;
  };
  const near = await measure('patch=clockwork&lines=1&wind=1');
  expect(near.detail).toBe('near');
  expect(near.frost).toBe(true);
  const hooks = await page.evaluate(() => {
    const hook = (window as IslandHooks).__islandMap;
    return { lines: hook?.lines() ?? null, wind: hook?.wind() ?? null };
  });
  // Wires lit and dark, rails, and wind of all three strengths on land.
  expect(hooks.lines?.wires ?? 0).toBeGreaterThan(0);
  expect(hooks.lines?.litWires ?? 0).toBeGreaterThan(0);
  expect(hooks.lines?.litWires ?? 0).toBeLessThan(hooks.lines?.wires ?? 0);
  expect(hooks.lines?.rails ?? 0).toBeGreaterThan(0);
  expect(hooks.wind?.shown).toBe(true);
  for (const n of hooks.wind?.tiles ?? []) expect(n).toBeGreaterThan(0);
  // The gallery never ticks: the arrows stand still.
  expect(hooks.wind?.moving).toBe(false);
  expect(near.drawCalls).toBeLessThanOrEqual(CLOCKWORK_BUDGET.drawCalls);
  expect(near.activeTriangles).toBeLessThanOrEqual(CLOCKWORK_BUDGET.nearTriangles);
  const far = await measure('patch=clockwork&lines=1&wind=1&far=1');
  expect(far.detail).toBe('far');
  expect(far.drawCalls).toBeLessThanOrEqual(near.drawCalls);
  expect(far.activeTriangles).toBeLessThanOrEqual(CLOCKWORK_BUDGET.farTriangles);
  // Christmas at night (snow falls through the season, the frost stays).
  const snowy = await measure('patch=clockwork&lines=1&wind=1&season=christmas&night=1');
  expect(snowy.frost).toBe(true);
  expect(snowy.snow).toBe(1);
  expect(snowy.drawCalls).toBeLessThanOrEqual(CLOCKWORK_BUDGET.drawCalls);
  // Cozy and Wild Isle wear no frost.
  expect((await measure('patch=wild')).frost).toBe(false);
  expect((await measure('patch=cozy')).frost).toBe(false);
  expect(shaderErrors).toEqual([]);
  test.info().annotations.push({ type: 'clockwork budget', description: JSON.stringify(seen) });
});
