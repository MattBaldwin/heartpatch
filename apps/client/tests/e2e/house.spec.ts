import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { expectRoomyLabels } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * The Keeper's house (#381, behind the `HP_HOUSE` switch, on for e2e in
 * playwright.config.ts): the home's house card opens the dollhouse, the
 * roof lifts off and the camera settles above it, and Back goes home. With
 * the switch off (the home reply has no `house`) there's no card and no
 * cottage. Checked through the dev hook, never pixels.
 */

interface HouseDebug {
  open: boolean;
  level: number;
  rooms: number;
  pose: 'glide' | 'walk' | 'dollhouse' | 'kid';
  zoom: number;
  scene: {
    rooms: number;
    keeper: boolean;
    pitch: number;
    roof: number;
    lights: number;
    frontWallAlpha: number | null;
  } | null;
}

interface HomeDebug {
  open: boolean;
  scene: { tiles: number; house: string | null } | null;
}

const houseState = (page: Page) => hook<HouseDebug>(page, 'house');
const homeState = (page: Page) => hook<HomeDebug>(page, 'home');
/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slow = { timeout: 60_000 };
const slowExpect = expect.configure(slow);

async function patchAndHome(page: Page): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Cottage Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await (await trayButton(page, 'home-open')).tap();
  await expect.poll(async () => (await homeState(page))?.scene?.tiles, slow).toBe(7);
}

test('enter the house from home, walk in and step out, and go back home', async ({ browser }) => {
  test.setTimeout(180_000); // two scene builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('house'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await patchAndHome(page);

  // The cottage stands on the Heart Seed tile. Home opens as its peek bar
  // (#412), with a 🏠 shortcut; the opened sheet has the house card.
  expect((await homeState(page))?.scene?.house).toBe('hut');
  const shortcut = page.getByTestId('home-house-shortcut');
  await slowExpect(shortcut).toHaveAccessibleName('Your house');
  const peek = (await page.getByTestId('home').boundingBox())!;
  expect(peek.height).toBeLessThan(page.viewportSize()!.height * 0.3); // still one short row
  await expectRoomyLabels(page, '[data-testid="home-house-shortcut"]');
  await page.getByTestId('home-handle').tap();
  const card = page.getByTestId('home-house');
  await slowExpect(card).toContainText('🏠 Your house');
  await expect(card).toContainText('House 1 · 2 beds');
  await page.getByTestId('home-handle').tap();
  await slowExpect(card).toBeHidden();

  await shortcut.tap();
  await expect.poll(async () => (await houseState(page))?.scene?.rooms, slow).toBe(1);
  // The roof lifts off and the camera settles in the dollhouse pose, looking down.
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  const house = (await houseState(page))!;
  expect(house).toMatchObject({ open: true, level: 1, zoom: 0 });
  expect(house.scene).toMatchObject({ keeper: true, roof: 1 });
  expect(house.scene!.pitch).toBeGreaterThanOrEqual(40);
  expect(house.scene!.pitch).toBeLessThanOrEqual(58);
  await expect(page.getByTestId('house-pill')).toHaveText('🏠 House 1');
  await expect(page.getByTestId('house-peek-line')).toHaveText('The Snug · 2 beds');
  await expect(page.getByTestId('home')).toBeHidden();
  // Big, roomy controls, all on screen.
  await expectRoomyLabels(page, '[data-testid="house-back"], [data-testid="house-pill"]');

  // Walk in: down to kid height; the front wall in the way fades, then is gone.
  const walk = page.getByTestId('house-walk');
  await expect(walk).toHaveText('👣 Walk in');
  await expectRoomyLabels(page, '[data-testid="house-walk"]');
  await walk.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('kid');
  await expect.poll(async () => (await houseState(page))?.scene?.pitch, slow).toBeLessThan(15);
  const inside = (await houseState(page))!;
  expect(inside.zoom).toBe(1);
  // Standing in the room, the front wall between the camera and it is gone
  // (alpha 0, not drawn): no veil, no seams through the squishies.
  expect(inside.scene!.frontWallAlpha).toBe(0);
  await expect(walk).toHaveText('🚪 Step out');

  // Step out: back up to the dollhouse, its front open again.
  await walk.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  const out = (await houseState(page))!;
  expect(out.zoom).toBe(0);
  expect(out.scene!.pitch).toBeGreaterThanOrEqual(40);
  expect(out.scene!.frontWallAlpha).toBeNull();
  await expect(walk).toHaveText('👣 Walk in');

  await page.getByTestId('house-back').tap();
  await expect(page.getByTestId('house')).toBeHidden();
  await expect.poll(async () => (await homeState(page))?.open, slow).toBe(true);
  expect((await houseState(page))?.open ?? false).toBe(false);
  expect(errors).toEqual([]);
});

test('with the house switched off there is no house card and no cottage', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('nohouse'));
  // The server leaves `house` out of the home reply while HP_HOUSE is off for a player.
  await page.route('**/api/v1/maps/*/home', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    delete body['house'];
    await route.fulfill({ response, json: body });
  });
  await patchAndHome(page);
  await slowExpect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByTestId('home-house-shortcut')).toHaveCount(0);
  await page.getByTestId('home-handle').tap();
  await expect(page.getByTestId('home-handle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('home-house')).toHaveCount(0);
  expect((await homeState(page))?.scene?.house).toBeNull();
});
