import { HOUSE_DATA, houseLevelData, roomsAt, type HouseView } from '@heartpatch/shared';
import { expect, test, type Page, type Route } from '@playwright/test';
import { hook } from './dev-hook.js';
import { expectRoomyLabels } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { grantItems } from './trading.js';
import { trayButton } from './trays.js';

/**
 * The Keeper's house (#381, behind the `HP_HOUSE` switch, on for e2e in
 * playwright.config.ts): the home's house card opens the dollhouse, the
 * roof lifts off and the camera settles above it, and Back goes home. With
 * the switch off (the home reply has no `house`) there's no card and no
 * cottage. Checked through the dev hook, never pixels.
 */

interface HouseDebug {
  mapId: string;
  open: boolean;
  sheet: 'peek' | 'open' | 'grow' | 'confirm';
  sparkles: number;
  building: boolean;
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
    floor: number;
    floors: number[];
    residents: number;
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
  // One floor: no Upstairs switch.
  await expect(page.getByTestId('house-floor')).toBeHidden();

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

test('a house with an upstairs shows one floor at a time, and walking in goes downstairs', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('floors'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // Stand in a level-3 house (the Kitchen upstairs over the Snug) for the real reply.
  await page.route('**/api/v1/maps/*/house', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as HouseView;
    const rooms = roomsAt(HOUSE_DATA, 3).map((room) => ({
      ...room,
      level: HOUSE_DATA.levels.find((l) => l.room.id === room.id)?.level ?? 1,
      residents: [],
    }));
    await route.fulfill({ response, json: { ...body, level: 3, rooms } });
  });
  await patchAndHome(page);
  await page.getByTestId('home-house-shortcut').tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  const ground = (await houseState(page))!;
  expect(ground.scene).toMatchObject({ rooms: 3, floor: 0, floors: [0, 1], keeper: true });

  // Upstairs: the Kitchen's floor comes back over the Snug, and the Keeper
  // (under it) isn't drawn.
  const floorButton = page.getByTestId('house-floor');
  await expect(floorButton).toHaveText('⬆ Upstairs');
  await expectRoomyLabels(page, '[data-testid="house-floor"], [data-testid="house-walk"]');
  await floorButton.tap();
  await expect.poll(async () => (await houseState(page))?.scene?.floor, slow).toBe(1);
  expect((await houseState(page))!.scene!.keeper).toBe(false);
  await expect(floorButton).toHaveText('⬇ Downstairs');

  // Walk in: kid height is in the Keeper's room, on the ground floor.
  await page.getByTestId('house-walk').tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('kid');
  expect((await houseState(page))!.scene).toMatchObject({ floor: 0, keeper: true });
  await expect(floorButton).toBeHidden();

  // Step out: the dollhouse on the ground floor, the switch back.
  await page.getByTestId('house-walk').tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  await expect(floorButton).toHaveText('⬆ Upstairs');
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

/** The `data-testid` of what has focus (the modal sheet keeps it inside). */
const focused = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['testid'] ?? null);

/** Opens the house's sheet and its Grow the house page. */
async function openGrow(page: Page): Promise<void> {
  await page.getByTestId('house-peek-handle').tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('open');
  // The handle swallows the touch's own click for a moment: tap until Grow opens.
  await expect(async () => {
    await page.getByTestId('house-grow-open').tap();
    expect((await houseState(page))?.sheet).toBe('grow');
  }).toPass(slow);
}

/** The house at level 2 (the Playroom added), as the server's build reply would be. */
function grown(one: HouseView): HouseView {
  const two = houseLevelData(HOUSE_DATA, 2);
  const three = houseLevelData(HOUSE_DATA, 3);
  return {
    ...one,
    level: 2,
    levelName: two.name,
    exterior: two.exterior,
    final: false,
    rooms: roomsAt(HOUSE_DATA, 2).map(
      (room) =>
        one.rooms.find((r) => r.id === room.id) ?? {
          id: room.id,
          name: room.name,
          description: room.description,
          beds: room.beds,
          look: room.look,
          layout: room.layout,
          level: 2,
          residents: [],
        },
    ),
    next: {
      level: 3,
      name: three.name,
      room: { id: three.room.id, name: three.room.name, beds: three.room.beds },
      final: false,
      requirements: [],
      cost: three.cost,
      unlocked: false,
      affordable: false,
    },
    items: {},
  };
}

test('grow the house: see what it needs, fill the bag, then build the Playroom', async ({
  browser,
}) => {
  test.setTimeout(240_000); // two scene builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('grow'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await patchAndHome(page);
  const shortcut = page.getByTestId('home-house-shortcut');
  await slowExpect(shortcut).toBeVisible();
  await shortcut.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  const { mapId } = (await houseState(page))!;

  // Folded, the sheet is one short row and the house fills the screen.
  const sheet = page.getByTestId('house-peek');
  expect((await sheet.boundingBox())!.height).toBeLessThan(page.viewportSize()!.height * 0.15);

  // A new Keeper: the server's rows, grouped, with what's done and what's not.
  await openGrow(page);
  await expect(page.getByTestId('house-grow-title')).toContainText('House 1 → 2');
  await expect(page.getByTestId('house-grow-room')).toHaveText('The Playroom · +2 beds');
  // Focus moves into the sheet: its ✕.
  await expect.poll(() => focused(page), slow).toBe('house-grow-close');
  // The scene and the HUD dim behind it and can't be reached: one way out, the ✕.
  await expect(page.getByTestId('house-scrim')).toBeVisible();
  const hudHidden = () =>
    page
      .getByTestId('house-back')
      .evaluate((b) => b.closest('[inert]') !== null && b.closest('[aria-hidden="true"]') !== null);
  expect(await hudHidden()).toBe(true);
  const rows = page.getByTestId('house-grow-row');
  await expect(rows).toHaveCount(HOUSE_DATA.levels[1]!.requirements.length);
  for (const group of ['seed', 'home', 'residents', 'land']) {
    await expect(page.getByTestId(`house-grow-group-${group}`)).toBeVisible();
  }
  // Everyone's Heart Seed is level 1, so the Seed cap row holds.
  await expect(
    page.getByTestId('house-grow-group-seed').getByTestId('house-grow-row'),
  ).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('house-grow-cost')).toHaveText('You need: 30 Timber · 20 Stone');
  const build = page.getByTestId('house-grow-build');
  await expect(build).toBeDisabled();
  await expect(build).toHaveText(/^⏳\s*Not yet: \d+\s+things? to go!$/);
  await expect(page.getByTestId('house-grow-next')).toHaveText(/^Next up: .+/);
  const steps = (text: string | null) => Number(/(\d+)/.exec(text ?? '')?.[1]);
  const before = steps(await build.textContent());
  await expectRoomyLabels(
    page,
    '[data-testid="house-grow-build"], [data-testid="house-grow-close"]',
  );

  // Fill the bag: the sheet re-reads the house when it opens again.
  await grantItems(page, mapId, { timber: 30, stone: 20 });
  await page.getByTestId('house-grow-close').tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('peek');
  await expect(page.getByTestId('house-scrim')).toBeHidden();
  expect(await hudHidden()).toBe(false);
  // Folded, focus goes back to the handle that opened it.
  await expect.poll(() => focused(page), slow).toBe('house-peek-handle');
  await openGrow(page);
  await expect(page.getByTestId('house-grow-need')).toHaveText(['🪵 30/30 ✓', '🪨 20/20 ✓']);
  expect(steps(await build.textContent())).toBe(before - 1);

  // Meeting every requirement for real takes days of play, so from here the
  // screen is shown every row done. The first build still goes to the real
  // server, which refuses it (the rows aren't met); only the success is stood in for.
  let levelOne: HouseView | null = null;
  let built: HouseView | null = null;
  // While `holdReads` is set, a read waits for `releaseReads` and then replies
  // with the house as it was when it was asked for (a stale read).
  let holdReads = false;
  let releaseReads: () => void = () => undefined;
  const readsReleased = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  await page.route('**/api/v1/maps/*/house', async (route: Route) => {
    const held = holdReads;
    const response = await route.fetch();
    const body = (await response.json()) as HouseView;
    levelOne = body;
    const ready: HouseView = built ?? {
      ...body,
      next: body.next && {
        ...body.next,
        requirements: body.next.requirements.map((r) => ({
          ...r,
          have: r.need,
          done: true,
          hint: null,
        })),
        unlocked: true,
        affordable: true,
      },
    };
    if (held) await readsReleased;
    await route.fulfill({ response, json: ready });
  });
  const posts: { key: string | undefined; body: unknown }[] = [];
  let buildLanded: () => void = () => undefined;
  const landed = new Promise<void>((resolve) => {
    buildLanded = resolve;
  });
  await page.route('**/api/v1/maps/*/house/build', async (route: Route) => {
    const request = route.request();
    posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    if (posts.length === 1) {
      await route.continue();
      return;
    }
    // Slow enough to try dismissing "Building…" while it's in flight.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    built = grown(levelOne!);
    await route.fulfill({ json: built });
    buildLanded();
  });
  // A tap on the dimmed scene closes the sheet too.
  await page.getByTestId('house-scrim').tap({ position: { x: 20, y: 200 } });
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('peek');
  await openGrow(page);
  await expect(build).toBeEnabled();
  await expect(build).toHaveText('Build it!');
  await expect(page.getByTestId('house-grow-next')).toHaveCount(0);

  // Build it! asks first (style guide §3.6), with focus on its yes; the real
  // server's refusal reads calmly.
  await build.tap();
  await expect(page.getByTestId('house-grow-confirm')).toHaveText(
    'Build the Playroom for 30 Timber and 20 Stone?',
  );
  await expect.poll(() => focused(page), slow).toBe('house-grow-yes');
  await page.getByTestId('house-grow-yes').tap();
  const note = page.getByTestId('house-note');
  await expect(note).toHaveText('Not quite yet! Check what the house needs.', slow);
  await expect(note).toHaveClass(/house-note-calm/);
  expect((await houseState(page))?.sheet).toBe('grow');
  await expect.poll(() => focused(page), slow).toBe('house-note');

  // Again: a new attempt, a new key.
  await build.tap();
  await page.getByTestId('house-grow-yes').tap();
  await expect.poll(async () => (await houseState(page))?.building, slow).toBe(true);
  // A re-read starts while it builds (through the dev hook; the sheet can't
  // be reopened mid-build). It's held until after the build replies, then
  // answers with the old level-1 house: the screen must drop it.
  holdReads = true;
  await page.evaluate(() => {
    (window as unknown as { __heartpatch: { house: () => { reread: () => void } } }).__heartpatch
      .house()
      .reread();
  });
  // While it builds, Escape and the scrim can't dismiss it, and focus stays
  // on the busy button, which says so.
  await page.keyboard.press('Escape');
  await page.getByTestId('house-scrim').tap({ position: { x: 20, y: 200 }, force: true });
  expect(await houseState(page)).toMatchObject({ sheet: 'confirm', building: true });
  const yes = page.getByTestId('house-grow-yes');
  await expect(yes).toHaveText('Building…');
  await expect(yes).toHaveAttribute('aria-disabled', 'true');
  expect(await focused(page)).toBe('house-grow-yes');
  await expect(note).toHaveText('Ta-da! The Playroom is ready. Who moves in?', slow);
  await expect(note).not.toHaveClass(/house-note-calm/);
  await expect.poll(() => focused(page), slow).toBe('house-note');
  await expect(page.getByTestId('house-pill')).toHaveText('🏠 House 2');
  await expect.poll(async () => (await houseState(page))?.scene?.rooms, slow).toBe(2);
  expect(await houseState(page)).toMatchObject({ level: 2, rooms: 2, sheet: 'open' });
  // The ta-da sparkle played once the new room drew (reduced motion would skip it).
  await expect.poll(async () => (await houseState(page))?.sparkles, slow).toBe(1);
  // Now the held level-1 read lands, after the build's reply: it's dropped.
  await landed;
  releaseReads();
  holdReads = false;
  await page.waitForTimeout(1_500);
  expect(await houseState(page)).toMatchObject({ level: 2, rooms: 2 });
  expect((await houseState(page))?.scene?.rooms).toBe(2);
  await expect(page.getByTestId('house-pill')).toHaveText('🏠 House 2');
  await expect(page.getByTestId('house-grow-open')).toBeVisible();
  expect(posts.map((p) => p.body)).toEqual([{ toLevel: 2 }, { toLevel: 2 }]);
  expect(posts[0]!.key).toMatch(/^[0-9a-f]{32}$/);
  expect(posts[1]!.key).toMatch(/^[0-9a-f]{32}$/);
  expect(posts[1]!.key).not.toBe(posts[0]!.key);
  expect(errors).toEqual([]);
});
