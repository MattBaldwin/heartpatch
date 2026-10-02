import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

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

type Hook = {
  __heartpatch?: {
    home?(): HomeDebug | null;
    map?(): MapDebug | null;
    idle(): boolean;
  };
};

const homeState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.home?.() ?? null);
const mapState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.() ?? null);

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
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(lobby).toBeHidden();
  await expect.poll(async () => (await mapState(page))?.tiles, { timeout: 30_000 }).toBe(469);

  // Stuff to build with, and a squishy friend (dev tools; spawns are #14).
  await page.getByTestId('bag-open').tap();
  await page.getByTestId('bag').getByRole('button', { name: 'Get stuff (dev)' }).tap();
  await expect(page.getByTestId('bag').locator('[data-item="timber"]')).toContainText('10');
  await page.getByTestId('bag').getByRole('button', { name: 'Close' }).tap();
  await page.getByTestId('battle-dev-grant').tap();
  await expect(page.locator('.battle-entry-note')).toContainText('joined you');

  // Home: seven tiles up close, the Keeper by the Heart Seed, nothing built yet.
  await page.getByTestId('home-open').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.tiles).toBe(7);
  const sheet = page.getByTestId('home');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('map-hud')).toBeHidden();
  await expect(page.getByTestId('home-fire')).toHaveText(
    'Build a Hearthfire to keep everyone safe at night!',
  );
  expect((await homeState(page))?.scene).toMatchObject({ keeper: true, buildings: 0 });

  // Build a Hearthfire: pick it, and the free spots light up.
  await sheet.getByTestId('home-build').tap();
  await sheet.locator('[data-build="hearthfire"]').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.spots).toBeGreaterThan(30);
  await sheet.getByTestId('home-anywhere').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.buildings).toBe(1);
  await expect(page.getByTestId('home-note')).toHaveText('Ta-da! Your Hearthfire is ready.');
  expect(await homeState(page)).toMatchObject({
    mode: 'selected',
    items: { timber: 5, stone: 5 },
    scene: { spots: 0, litFires: 0 },
  });

  // Fuel it: one night per tap, and it lights up.
  await sheet.getByTestId('home-fuel').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.litFires).toBe(1);
  await expect(page.getByTestId('home-fire')).toHaveText('Your fire is lit: 1 night left.');
  await sheet.getByTestId('home-fuel').tap();
  await expect(page.getByTestId('home-fire')).toHaveText('Your fire is lit: 2 nights left.');
  expect((await homeState(page))?.items['emberwood']).toBe(8);

  // A Cozy Meadow, and the squishy moves in.
  await sheet.getByTestId('home-done').tap();
  await sheet.getByTestId('home-build').tap();
  await sheet.locator('[data-build="cozy-meadow"]').tap();
  await sheet.getByTestId('home-anywhere').tap();
  await expect.poll(async () => (await homeState(page))?.scene?.buildings).toBe(2);
  await expect(sheet.getByTestId('home-residents')).toBeVisible();
  await sheet.getByTestId('home-residents').getByRole('button', { name: 'Move in' }).tap();
  await expect.poll(async () => (await homeState(page))?.scene?.housed).toBe(1);
  const meadow = (await homeState(page))?.buildings.find((b) => b.buildingId === 'cozy-meadow');
  expect(meadow?.residents).toBe(1);

  // It wanders about its habitat, hop by hop, and the scene goes idle between hops.
  await expect
    .poll(async () => (await homeState(page))?.hops, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hook).__heartpatch?.idle() ?? false), {
      // Sample often: the idle gap between hops is a couple of seconds, and
      // expect.poll's default back-off (up to 1 s) can step over it on a slow runner.
      intervals: [100],
      timeout: 20_000,
    })
    .toBe(true);

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
  await expect(panel).toContainText('Hearthfire: lit and keeping everyone cozy.');
  await expect(panel).toContainText('Cozy Meadow');
  await panel.getByTestId('tile-home').tap();
  await expect.poll(async () => (await homeState(page))?.open).toBe(true);

  expect(errors).toEqual([]);
});
