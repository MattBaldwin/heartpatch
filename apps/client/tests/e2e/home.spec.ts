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

  // The Hearthfire isn't built at home (owner decision 2026-10-07): its row
  // says where fires go, with no Build button.
  await sheet.getByTestId('home-build').tap();
  const fireRow = sheet.locator('[data-build-row="hearthfire"]');
  await slowExpect(fireRow).toContainText(
    'Fires go on your land, in the middle of a tile 🔥. Your Heart Seed keeps home safe!',
  );
  await slowExpect(fireRow.getByRole('button')).toHaveCount(0);
  // Each row says what the building does (#207): a line, then effect chips.
  await expect(fireRow).toContainText(
    'Keeps squishies out on your land safe from the Hollow Man at night.',
  );
  await expect(fireRow.locator('.home-effect')).toHaveText([
    '🛡️ Safe 1 tile around',
    '🪵 Needs fuel each night',
  ]);
  // The Build button sits under the chips on a phone, still on screen.
  const meadowRow = sheet.locator('[data-build-row="cozy-meadow"]');
  const chips = (await meadowRow.locator('.home-effects').boundingBox())!;
  const build = (await meadowRow.locator('[data-build="cozy-meadow"]').boundingBox())!;
  const view = page.viewportSize()!;
  expect(build.x + build.width).toBeLessThanOrEqual(view.width);
  if (view.width < 600) expect(build.y).toBeGreaterThanOrEqual(chips.y + chips.height - 1);
  await sheet.getByRole('button', { name: 'Cancel' }).tap();

  // A Cozy Meadow, and the squishy moves in.
  await sheet.getByTestId('home-build').tap();
  await sheet.locator('[data-build="cozy-meadow"]').tap();
  await sheet.getByTestId('home-anywhere').tap();
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

  // The Heart Seed's tile panel lists them, with a way home.
  const box = (await page.locator('#game').boundingBox())!;
  await tapCanvas(page, box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.getByTestId('tile-panel');
  await slowExpect(panel).toContainText('Cozy Meadow');
  await panel.getByTestId('tile-home').tap();
  await expect.poll(async () => (await homeState(page))?.open, slow).toBe(true);

  expect(errors).toEqual([]);
});
