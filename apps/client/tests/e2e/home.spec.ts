import { findAvoidedWords, houseTile } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, draws, hook, idle } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { closeRoster } from './roster.js';
import { trayButton } from './trays.js';

/** Longer than one wander gap (home-config.ts `WANDER`: 3.5 s ± 1.5 s). */
const WANDER_EVERY_MS = 5_000;

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });

/**
 * Home base (#18): the Heart Seed keeps home safe (#202: fires go on your
 * land, so the build sheet points there), build a habitat, move a squishy in
 * and watch it wander, then see home's safe glow on the map. Everything is
 * checked through the dev hook's counters, not pixels. Fires on land:
 * territory.spec.ts.
 */

interface HomeDebug {
  mapId: string;
  open: boolean;
  mode: string;
  items: Record<string, number>;
  buildings: {
    id: string;
    buildingId: string;
    lit: boolean | null;
    nightsLeft: number | null;
    residents: number | null;
  }[];
  squishies: number;
  scene: {
    tiles: number;
    buildings: number;
    litFires: number;
    squishies: number;
    housed: number;
    keeper: boolean;
    spots: number;
  } | null;
  hops: number;
  sheet: 'peek' | 'open';
}

interface MapDebug {
  tiles: number;
  buildings: number;
  litFires: number;
  safeTiles: number;
}

const homeState = (page: Page) => hook<HomeDebug>(page, 'home');
const mapState = (page: Page) => hook<MapDebug>(page, 'map');

/** A touch tap on the canvas as pointer events (as map.spec.ts does). */
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

test('keeps home safe without a fire, houses a squishy, and shows the safe glow', async ({
  browser,
}) => {
  test.setTimeout(150_000); // two scene builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('home'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Cozy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await expect.poll(async () => (await mapState(page))?.tiles, { timeout: 30_000 }).toBe(817); // a new 6-seat patch (#318)

  // Stuff to build with, and a squishy friend (dev tools; spawns are #14).
  await (await trayButton(page, 'bag-open')).tap();
  await page.getByTestId('bag').getByRole('button', { name: 'Get stuff (dev)' }).tap();
  await slowExpect(page.getByTestId('bag').locator('[data-item="timber"]')).toContainText('10');
  await page.getByTestId('bag').getByRole('button', { name: 'Close' }).tap();
  await (await trayButton(page, 'battle-dev-grant')).tap();
  await slowExpect(page.locator('.battle-entry-note')).toContainText('joined you');

  // Home: seven tiles up close, the Keeper by the Heart Seed, nothing built yet.
  await (await trayButton(page, 'home-open')).tap();
  // Building a scene can take a while on a busy CI runner (software rendering).
  const slow = { timeout: 30_000 };
  await expect.poll(async () => (await homeState(page))?.scene?.tiles, slow).toBe(7);
  const sheet = page.getByTestId('home');
  await slowExpect(sheet).toBeVisible();
  await slowExpect(page.getByTestId('map-hud')).toBeHidden();
  await slowExpect(page.getByTestId('home-fire')).toHaveText('Your Heart Seed keeps home safe 💗');
  // No fires on land yet: no count and no "Fuel all fires".
  await slowExpect(page.getByTestId('home-land-fires')).toBeHidden();
  await slowExpect(page.getByTestId('home-fuel-all')).toHaveCount(0);
  expect((await homeState(page))?.scene).toMatchObject({ keeper: true, buildings: 0 });
  // The title and fire status sit clear of the "Hi, name! Log out" chip (#157).
  const header = (await page.locator('.home-top').boundingBox())!;
  const chip = (await page.locator('.auth-chip').boundingBox())!;
  expect(header.y).toBeGreaterThanOrEqual(chip.y + chip.height);

  // The sheet opens as a short peek bar (#412): the squishies by the Heart
  // Seed stay in view, and every button is on screen with no scrolling.
  await expect.poll(async () => (await homeState(page))?.sheet).toBe('peek');
  const view = page.viewportSize()!;
  for (const id of ['home-squishies', 'home-build', 'home-back']) {
    const box = (await sheet.getByTestId(id).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const bar = (await sheet.boundingBox())!;
  expect(bar.height).toBeLessThan(view.height * 0.3);
  // Squishies opens the Squishies roster (#375), the same as 🐾 at the top.
  await sheet.getByTestId('home-squishies').tap();
  await slowExpect(page.getByTestId('roster')).toBeVisible();
  await closeRoster(page);
  // The handle says what it does (#433): "More" folded, "Less" open, and
  // names the area it opens and folds.
  const handle = sheet.getByTestId('home-handle');
  await expect(handle).toHaveAttribute('aria-controls', 'home-body');
  await expect(page.locator('#home-body')).toHaveCount(1);
  await expect(handle).toContainText('More');
  // The handle opens the full sheet and folds it back.
  await sheet.getByTestId('home-handle').tap();
  await expect(sheet.getByTestId('home-handle')).toHaveAttribute('aria-expanded', 'true');
  await expect(handle).toContainText('Less');
  await sheet.getByTestId('home-handle').tap();
  await expect.poll(async () => (await homeState(page))?.sheet).toBe('peek');
  // A swipe up on the handle opens it, a swipe down folds it.
  const swipe = async (dy: number) => {
    const grip = (await sheet.getByTestId('home-handle').boundingBox())!;
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.evaluate(
      ({ x, y, dy }) => {
        const handle = document.querySelector('[data-testid="home-handle"]')!;
        const at = (type: string, clientY: number) =>
          handle.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY,
              bubbles: true,
            }),
          );
        at('pointerdown', y);
        at('pointerup', y + dy);
        handle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
      { x, y, dy },
    );
  };
  await swipe(-80);
  await expect.poll(async () => (await homeState(page))?.sheet).toBe('open');
  await swipe(80);
  await expect.poll(async () => (await homeState(page))?.sheet).toBe('peek');
  // Opened, it stays open through Build and Cancel (below) while Home is open.
  await sheet.getByTestId('home-handle').tap();
  await expect.poll(async () => (await homeState(page))?.sheet).toBe('open');

  // Only buildings that go at home have a card (the habitats): fires and
  // homestead buildings are built out on the land, and one line says so.
  await sheet.getByTestId('home-build').tap();
  await slowExpect(sheet.getByTestId('build-sheet')).toBeVisible();
  await expect(sheet.locator('[data-build]')).toHaveCount(2);
  await expect(sheet.locator('[data-build="hearthfire"]')).toHaveCount(0);
  await expect(sheet.getByTestId('build-note')).toContainText(
    'Fires go out on your land: tap a tile on the map 🔥',
  );
  // Picking a card says what it does and costs, in one line.
  await sheet.locator('[data-build="cozy-meadow"]').tap();
  await expect(sheet.locator('[data-build="cozy-meadow"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByTestId('build-detail')).toContainText('·');
  await expect(sheet.getByTestId('build-hint')).toHaveText('Tap a glowing tile!');
  // Free tiles glow, one each (#589): the Heart Seed tile and the ring but the house's (#604).
  await expect.poll(async () => (await homeState(page))?.scene?.spots, slow).toBe(6);
  // Build! stays on screen on a phone, and so does the whole row.
  const go = (await sheet.getByTestId('build-go').boundingBox())!;
  expect(go.x + go.width).toBeLessThanOrEqual(view.width);
  expect(go.y + go.height).toBeLessThanOrEqual(view.height);
  await sheet.getByTestId('build-cancel').tap();
  await slowExpect(sheet.getByTestId('home-build')).toBeVisible();
  expect((await homeState(page))?.sheet).toBe('open');

  // Home opens folded again the next time.
  await sheet.getByTestId('home-back').tap();
  await slowExpect(sheet).toBeHidden();
  await (await trayButton(page, 'home-open')).tap();
  await expect.poll(async () => (await homeState(page))?.scene?.tiles, slow).toBe(7);
  await expect.poll(async () => (await homeState(page))?.sheet).toBe('peek');
  await slowExpect(sheet.getByTestId('home-build')).toBeVisible();

  // On a short screen held sideways, with a note up, Back to map is still in
  // reach: the bar scrolls rather than cut it off (#412).
  await page.setViewportSize({ width: 667, height: 375 });
  await page.getByTestId('home-note').evaluate((note) => {
    note.textContent = 'Your bag ran out! 3 fires got more. The lowest went first. 🔥';
  });
  // Either it all fits, or a finger can scroll to it (a script can scroll
  // overflow: hidden too, so check what a finger can do, not just the box).
  const fit = await sheet.evaluate((el) => ({
    fits: el.scrollHeight <= el.clientHeight,
    scrolls: ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
  }));
  expect(fit.fits || fit.scrolls).toBe(true);
  const back = sheet.getByTestId('home-back');
  await back.scrollIntoViewIfNeeded();
  const backBox = (await back.boundingBox())!;
  const shown = (await sheet.boundingBox())!;
  expect(backBox.y).toBeGreaterThanOrEqual(shown.y);
  expect(backBox.y + backBox.height).toBeLessThanOrEqual(shown.y + shown.height);
  await page.getByTestId('home-note').evaluate((note) => {
    note.textContent = '';
  });
  await page.setViewportSize(view);

  // A Cozy Meadow on the first lit tile, and the squishy moves in.
  await sheet.getByTestId('home-build').tap();
  await sheet.locator('[data-build="cozy-meadow"]').tap();
  await sheet.getByTestId('build-go').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.buildings, slow).toBe(1);
  await slowExpect(sheet.getByTestId('home-residents')).toBeVisible();
  // Their starter and the dev squishy can both move in; one does.
  await sheet.getByTestId('home-residents').getByRole('button', { name: 'Move in' }).first().tap();
  await expect.poll(async () => (await homeState(page))?.scene?.housed, slow).toBe(1);
  const meadow = (await homeState(page))?.buildings.find((b) => b.buildingId === 'cozy-meadow');
  expect(meadow?.residents).toBe(1);

  // It wanders about its habitat, hop by hop…
  await expect
    .poll(async () => (await homeState(page))?.hops, { timeout: 30_000 })
    .toBeGreaterThan(0);
  // …and with reduced motion it stays put, so the home draws nothing at all.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => idle(page), {
      timeout: 30_000,
    })
    .toBe(true);
  const hops = (await homeState(page))?.hops ?? 0;
  const before = await draws(page);
  await page.waitForTimeout(WANDER_EVERY_MS * 2);
  expect(await draws(page)).toBe(before);
  expect((await homeState(page))?.hops).toBe(hops);
  await page.emulateMedia({ reducedMotion: null });

  // Kid-friendly words only (style guide §9).
  expect(findAvoidedWords((await sheet.textContent()) ?? '')).toEqual([]);

  // Back on the map: everyone sees the meadow, and home's safe glow with no fire lit.
  await sheet.getByTestId('home-done').tap();
  await sheet.getByTestId('home-back').tap();
  await expect.poll(async () => (await mapState(page))?.buildings, { timeout: 30_000 }).toBe(1);
  const map = await mapState(page);
  expect(map).toMatchObject({ litFires: 0 });
  expect(map?.safeTiles).toBeGreaterThanOrEqual(7);
  expect((await homeState(page))?.open).toBe(false);

  // The Heart Seed's tile panel has a way home (the meadow fills a ring tile, #589).
  const box = (await page.locator('#game').boundingBox())!;
  await tapCanvas(page, box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.getByTestId('tile-panel');
  await slowExpect(panel).toContainText('Your home base');
  await panel.getByTestId('tile-home').tap();
  await expect.poll(async () => (await homeState(page))?.open, slow).toBe(true);

  expect(errors).toEqual([]);
});

/** Builds through the server, as the Build sheet's Build! does (an idempotency key each). */
async function buildAt(
  page: Page,
  mapId: string,
  body: { buildingId: string; q: number; r: number; spot: number },
): Promise<number> {
  return page.evaluate(
    async ({ mapId, body }) => {
      const res = await fetch(`/api/v1/maps/${mapId}/buildings`, {
        method: 'POST',
        headers: {
          'x-requested-with': 'heartpatch',
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return res.status;
    },
    { mapId, body },
  );
}

test('a home base with no room says why, and lights no tile (#537)', async ({ browser }) => {
  test.setTimeout(240_000); // two home scene builds (six buildings) and the map between; CI renders in software
  const page = await newPlayer(browser, uniqueName('full'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Full Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await expect
    .poll(async () => (await mapState(page))?.tiles, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;

  // Four Ember Dens and two Cozy Meadows (four each may stand, owner
  // 2026-10-18): one on every home tile but the house's (#604, HP_HOUSE is
  // on for e2e), so a meadow could go up but has no room.
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/items`, { items: { timber: 40, stone: 20 } }))
      .status,
  ).toBe(201);
  const home = await api<{ tiles: { q: number; r: number; heartSeed: boolean }[] }>(
    page,
    'GET',
    `/maps/${mapId}/home`,
  );
  expect(home.body.tiles).toHaveLength(7);
  const house = houseTile(home.body.tiles, [])!;
  const tiles = home.body.tiles
    .filter((t) => t.q !== house.q || t.r !== house.r)
    .sort((a, b) => Number(b.heartSeed) - Number(a.heartSeed));
  for (const [i, buildingId] of [
    'ember-den',
    'ember-den',
    'ember-den',
    'ember-den',
    'cozy-meadow',
    'cozy-meadow',
  ].entries()) {
    const tile = tiles[i]!;
    expect(await buildAt(page, mapId, { buildingId, q: tile.q, r: tile.r, spot: 1 })).toBeLessThan(
      300,
    );
  }

  // Build: no den card, no meadow card (no room), and the sheet says why
  // (the owner saw no reason).
  await (await trayButton(page, 'home-open')).tap();
  const slow = { timeout: 30_000 };
  await expect.poll(async () => (await homeState(page))?.scene?.buildings, slow).toBe(6);
  const sheet = page.getByTestId('home');
  await sheet.getByTestId('home-build').tap();
  await slowExpect(sheet.getByTestId('build-sheet')).toBeVisible();
  await expect(sheet.locator('[data-build="ember-den"]')).toHaveCount(0);
  // No free tile: the line on top says why, once, and no card repeats it.
  await expect(sheet.locator('[data-build]')).toHaveCount(0);
  await expect(sheet.getByTestId('build-hint')).toHaveText(
    'Your home base is full! Tap Not now, then tap one to upgrade ⬆️',
  );
  const hint = (await sheet.getByTestId('build-hint').boundingBox())!;
  const view = page.viewportSize()!;
  expect(hint.x + hint.width).toBeLessThanOrEqual(view.width);
  expect(findAvoidedWords((await sheet.textContent()) ?? '')).toEqual([]);

  // Full: no tile glows, and no card for the lantern or the fires (they go out on the land).
  expect((await homeState(page))?.scene?.spots).toBe(0);
  await expect(sheet.locator('[data-build="jack-o-lantern-hearthfire"]')).toHaveCount(0);
  await expect(sheet.getByTestId('build-note')).toContainText('Fires go out on your land');
  await sheet.getByTestId('build-cancel').tap();
  await slowExpect(sheet.getByTestId('home-build')).toBeVisible();

  expect(errors).toEqual([]);
});
