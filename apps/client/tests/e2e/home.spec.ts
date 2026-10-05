import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { draws, hook, idle } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/** Longer than one wander gap (home-config.ts `WANDER`: 3.5 s ± 1.5 s). */
const WANDER_EVERY_MS = 5_000;

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });

/**
 * Home base (#18): build a Hearthfire and a habitat, fuel the fire, move a
 * squishy in and watch it wander, then see the fire's safe glow on the map.
 * Everything is checked through the dev hook's counters, not pixels.
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

test('builds and fuels a Hearthfire, houses a squishy, and shows the safe glow', async ({
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
  await expect.poll(async () => (await mapState(page))?.tiles, { timeout: 30_000 }).toBe(469);

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
  await slowExpect(page.getByTestId('home-fire')).toHaveText(
    'Build a Hearthfire to keep everyone safe at night!',
  );
  expect((await homeState(page))?.scene).toMatchObject({ keeper: true, buildings: 0 });
  // The title and fire status sit clear of the "Hi, name! Log out" chip (#157).
  const header = (await page.locator('.home-top').boundingBox())!;
  const chip = (await page.locator('.auth-chip').boundingBox())!;
  expect(header.y).toBeGreaterThanOrEqual(chip.y + chip.height);

  // Build a Hearthfire: pick it, and the free spots light up.
  await sheet.getByTestId('home-build').tap();
  await sheet.locator('[data-build="hearthfire"]').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.spots, slow).toBeGreaterThan(30);
  await sheet.getByTestId('home-anywhere').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.buildings, slow).toBe(1);
  await slowExpect(page.getByTestId('home-note')).toHaveText('Ta-da! Your Hearthfire is ready.');
  expect(await homeState(page)).toMatchObject({
    mode: 'selected',
    items: { timber: 5, stone: 5 },
    scene: { spots: 0, litFires: 0 },
  });

  // Fuel it: one night per tap, and it lights up.
  await sheet.getByTestId('home-fuel').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.litFires, slow).toBe(1);
  await slowExpect(page.getByTestId('home-fire')).toHaveText('Your fire is lit: 1 night left.');
  await sheet.getByTestId('home-fuel').tap();
  await slowExpect(page.getByTestId('home-fire')).toHaveText('Your fire is lit: 2 nights left.');
  expect((await homeState(page))?.items['emberwood']).toBe(8);

  // A Cozy Meadow, and the squishy moves in.
  await sheet.getByTestId('home-done').tap();
  await sheet.getByTestId('home-build').tap();
  await sheet.locator('[data-build="cozy-meadow"]').tap();
  await sheet.getByTestId('home-anywhere').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.buildings, slow).toBe(2);
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

  // Back on the map: everyone sees the buildings, and the lit fire's safe glow.
  await sheet.getByTestId('home-done').tap();
  await sheet.getByTestId('home-back').tap();
  await expect.poll(async () => (await mapState(page))?.buildings, { timeout: 30_000 }).toBe(2);
  const map = await mapState(page);
  expect(map).toMatchObject({ litFires: 1 });
  expect(map?.safeTiles).toBeGreaterThanOrEqual(7);
  expect((await homeState(page))?.open).toBe(false);

  // The Heart Seed's tile panel lists them, with a way home.
  const box = (await page.locator('#game').boundingBox())!;
  await tapCanvas(page, box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.getByTestId('tile-panel');
  await slowExpect(panel).toContainText('Hearthfire: lit and keeping everyone cozy.');
  await slowExpect(panel).toContainText('Cozy Meadow');
  await panel.getByTestId('tile-home').tap();
  await expect.poll(async () => (await homeState(page))?.open, slow).toBe(true);

  expect(errors).toEqual([]);
});
