import { HOUSE_DATA, houseLevelData, roomsAt, type HouseView } from '@heartpatch/shared';
import { expect, test, type Page, type Route } from '@playwright/test';
import { hook } from './dev-hook.js';
import { expectRoomyLabels } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { closeRoster, openRoster } from './roster.js';
import { touch } from './touch.js';
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
  sheet: 'peek' | 'open' | 'grow' | 'confirm' | 'gift' | 'picker' | 'move-out';
  sparkles: number;
  gift: { shown: boolean; opening: boolean; opened: number };
  welcomed: boolean;
  flicker: { running: boolean; hz: number; ticks: number };
  building: boolean;
  moving: boolean;
  pickRoom: string | null;
  level: number;
  rooms: number;
  pose: 'glide' | 'walk' | 'dollhouse' | 'kid';
  zoom: number;
  keeper: { x: number; y: number } | null;
  walk: {
    room: string | null;
    at: { x: number; y: number; z: number };
    stick: boolean;
    walkingTo: boolean;
  } | null;
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
    gift: boolean;
    light: { phase: string; lit: boolean };
  } | null;
}

interface HomeDebug {
  open: boolean;
  scene: { tiles: number; house: string | null; houseTile: { q: number; r: number } | null } | null;
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

  // The cottage fills its own ring tile (#604), the back-right one on a new
  // home. Home opens as its peek bar (#412), with a 🏠 shortcut; the opened
  // sheet has the house card.
  expect((await homeState(page))?.scene).toMatchObject({
    house: 'hut',
    houseTile: { q: 1, r: -1 },
  });
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
  // The first visit of the patch day says welcome home (#381 H2).
  // (The line itself shows for a few seconds, which a slow runner can outlast.)
  expect((await houseState(page))?.welcomed).toBe(true);
  // No gift today (nobody lives here yet): no gift line, no box.
  await expect(page.getByTestId('house-gift-line')).toBeHidden();
  expect((await houseState(page))?.scene?.gift).toBe(false);
  // Big, roomy controls, all on screen.
  await expectRoomyLabels(page, '[data-testid="house-back"], [data-testid="house-pill"]');
  // One floor: no Upstairs switch.
  await expect(page.getByTestId('house-floor')).toBeHidden();

  // Walk in (#381 W2), here with a tap on the Keeper (the button does the
  // same, below): the camera glides down behind it; the front wall in the
  // way fades, then is gone.
  const walk = page.getByTestId('house-walk');
  await expect(walk).toHaveText('👣 Walk in');
  await expectRoomyLabels(page, '[data-testid="house-walk"]');
  const keeper = (await houseState(page))!.keeper!;
  await page.mouse.click(keeper.x, keeper.y);
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('kid');
  await expect.poll(async () => (await houseState(page))?.scene?.pitch, slow).toBeLessThan(15);
  const inside = (await houseState(page))!;
  expect(inside.zoom).toBe(1);
  // Standing in the room, the front wall between the camera and it is gone
  // (alpha 0, not drawn): no veil, no seams through the squishies.
  expect(inside.scene!.frontWallAlpha).toBe(0);
  await expect(walk).toHaveText('🚪 Step out');
  expect(inside.walk).toMatchObject({ room: 'snug', stick: false, walkingTo: false });

  // A drag anywhere is the joystick: up walks the Keeper in, away from the camera.
  const stick = page.getByTestId('house-stick');
  await expect(stick).toBeVisible();
  const from = inside.walk!.at;
  const vw = page.viewportSize()!;
  await page.mouse.move(vw.width * 0.5, vw.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(vw.width * 0.5, vw.height * 0.5 - i * 10);
  await expect.poll(async () => (await houseState(page))?.walk?.stick, slow).toBe(true);
  await expect
    .poll(async () => (await houseState(page))!.walk!.at.z - from.z, slow)
    .toBeGreaterThan(0.2);
  await page.mouse.up();
  await expect.poll(async () => (await houseState(page))?.walk?.stick, slow).toBe(false);
  // A drag is never also a tap on the floor, even one the tap recogniser
  // still takes for a tap (8 px each way: under its slop per axis, past the
  // stick's 10 px across).
  expect((await houseState(page))!.walk!.walkingTo).toBe(false);
  await page.mouse.move(vw.width * 0.5, vw.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(vw.width * 0.5 + 8, vw.height * 0.6 + 8, { steps: 2 });
  await page.mouse.up();
  await expect.poll(async () => (await houseState(page))?.walk?.stick, slow).toBe(false);
  expect((await houseState(page))!.walk!.walkingTo).toBe(false);

  // A tap on the floor, to the Keeper's right: it walks over there and stops.
  const before = (await houseState(page))!;
  const at = before.keeper!;
  await page.mouse.click(at.x + 90, at.y + 60);
  await expect
    .poll(async () => (await houseState(page))!.walk!.at.x - before.walk!.at.x, slow)
    .toBeGreaterThan(0.2);
  await expect.poll(async () => (await houseState(page))?.walk?.walkingTo, slow).toBe(false);
  const walked = (await houseState(page))!.walk!.at;

  // Step out: back up to the dollhouse, its front open again; the Keeper stays where it was left.
  await walk.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  const out = (await houseState(page))!;
  expect(out.zoom).toBe(0);
  expect(out.scene!.pitch).toBeGreaterThanOrEqual(40);
  expect(out.scene!.frontWallAlpha).toBeNull();
  await expect(walk).toHaveText('👣 Walk in');
  await expect(stick).toBeHidden();
  // Walk in again: the camera finds the Keeper where it was left.
  await walk.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('kid');
  const again = (await houseState(page))!.walk!.at;
  expect(again.x).toBeCloseTo(walked.x, 3);
  expect(again.z).toBeCloseTo(walked.z, 3);
  await walk.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');

  // A pinch only zooms: apart sinks toward kid height, together comes back
  // up and stops at the dollhouse. Only Back leaves (Controls A; a pinch
  // zooms on the map and in the house alike).
  const mid = { x: vw.width * 0.5, y: vw.height * 0.5 };
  const spread = (from: number, to: number) =>
    Array.from({ length: 9 }, (_, i) => {
      const half = from + ((to - from) * i) / 8;
      return { 1: { x: mid.x - half, y: mid.y }, 2: { x: mid.x + half, y: mid.y } };
    });
  await touch(page, spread(40, 160), { hitTest: true });
  await expect.poll(async () => (await houseState(page))?.zoom, slow).toBeGreaterThan(0);
  await touch(page, spread(160, 10), { hitTest: true });
  await expect.poll(async () => (await houseState(page))?.zoom, slow).toBe(0);
  await expect(page.getByTestId('house')).toBeVisible();
  expect((await houseState(page))?.open).toBe(true);

  await page.getByTestId('house-back').tap();
  await expect(page.getByTestId('house')).toBeHidden();
  await expect.poll(async () => (await homeState(page))?.open, slow).toBe(true);
  expect((await houseState(page))?.open ?? false).toBe(false);
  // Nothing ticks once the house is gone: the fire's flicker stopped with it.
  expect((await houseState(page))?.flicker.running).toBe(false);
  expect(errors).toEqual([]);
});

test('today’s gift waits in the house: open it once and the box goes away', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('gift'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // A resident left a gift today (the server rolls it): every read shows it
  // wrapped until the claim lands, then opened.
  let claimed = false;
  const day = '2026-10-12';
  const note = 'Someone wrapped this all by themselves! 🎁';
  const withGift = (body: HouseView): HouseView => ({
    ...body,
    gift: { day, giverSquishyId: null, itemId: 'timber', count: 3, note, claimed },
  });
  await page.route('**/api/v1/maps/*/house', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: withGift((await response.json()) as HouseView) });
  });
  const posts: { key: string | undefined; body: unknown }[] = [];
  await page.route('**/api/v1/maps/*/house/gift/claim', async (route: Route) => {
    const request = route.request();
    posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    const house = await page.request.get(request.url().replace(/\/gift\/claim$/, ''));
    claimed = true;
    await route.fulfill({ json: withGift((await house.json()) as HouseView) });
  });
  await patchAndHome(page);
  await page.getByTestId('home-house-shortcut').tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');

  // The box sits by the hearth (its giver isn't drawn), and the peek bar says so.
  expect((await houseState(page))?.scene?.gift).toBe(true);
  const line = page.getByTestId('house-gift-line');
  await expect(line).toHaveText('🎁 A little gift is waiting for you!');
  await expectRoomyLabels(page, '[data-testid="house-gift-line"]');

  // The line opens the card: the server's note as given, what's inside, Open it!.
  await expect(async () => {
    await line.tap();
    expect((await houseState(page))?.sheet).toBe('gift');
  }).toPass(slow);
  await expect(page.getByTestId('house-gift-note')).toHaveText(note);
  await expect(page.getByTestId('house-gift-item')).toHaveText(/3\s+Timber/);
  const open = page.getByTestId('house-gift-yes');
  await expect(open).toHaveText('Open it!');
  await expectRoomyLabels(page, '[data-testid="house-gift-yes"], [data-testid="house-gift-close"]');
  await expect(page.getByTestId('house-scrim')).toBeVisible();

  // Open it!: one claim with its Idempotency-Key; the box pops and goes, a toast cheers.
  await open.tap();
  await expect.poll(async () => (await houseState(page))?.gift.opened, slow).toBe(1);
  await expect(page.getByTestId('house-note')).toHaveText(/^\+3\s+Timber\s+🎁$/, slow);
  expect(await houseState(page)).toMatchObject({ sheet: 'peek', gift: { shown: false } });
  expect((await houseState(page))?.scene?.gift).toBe(false);
  await expect(line).toBeHidden();
  await expect(page.getByTestId('house-scrim')).toBeHidden();

  // Opening the sheet re-reads the house: the gift stays opened, nothing comes back.
  await page.getByTestId('house-peek-handle').tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('open');
  await page.waitForTimeout(1_000);
  expect((await houseState(page))?.scene?.gift).toBe(false);
  await expect(line).toBeHidden();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.body).toEqual({ day });
  expect(posts[0]!.key).toMatch(/^[0-9a-f]{32}$/);
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

  // Upstairs: the Kitchen's floor comes back over the Snug. The Keeper
  // stays drawn (#381 W1: it walks between floors, so the cut keeps it).
  const floorButton = page.getByTestId('house-floor');
  await expect(floorButton).toHaveText('⬆️ Upstairs');
  await expectRoomyLabels(page, '[data-testid="house-floor"], [data-testid="house-walk"]');
  await floorButton.tap();
  await expect.poll(async () => (await houseState(page))?.scene?.floor, slow).toBe(1);
  expect((await houseState(page))!.scene!.keeper).toBe(true);
  await expect(floorButton).toHaveText('⬇️ Downstairs');

  // Walk in: kid height is in the Keeper's room, on the ground floor.
  await page.getByTestId('house-walk').tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('kid');
  expect((await houseState(page))!.scene).toMatchObject({ floor: 0, keeper: true });
  await expect(floorButton).toBeHidden();

  // Step out: the dollhouse on the ground floor, the switch back.
  await page.getByTestId('house-walk').tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  await expect(floorButton).toHaveText('⬆️ Upstairs');
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
  // The second build's reply waits for `releaseBuild`, so "Building…" stays in
  // flight for as long as the checks on it take (a timer ran out on slow CI).
  let releaseBuild: () => void = () => undefined;
  const buildReleased = new Promise<void>((resolve) => {
    releaseBuild = resolve;
  });
  await page.route('**/api/v1/maps/*/house/build', async (route: Route) => {
    const request = route.request();
    posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    if (posts.length === 1) {
      await route.continue();
      return;
    }
    // Held while the test tries dismissing "Building…".
    await buildReleased;
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
  // Now the build replies.
  releaseBuild();
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

/** Taps a control in the just-opened sheet (the handle swallows the touch's own click for a moment). */
async function tapInSheet(page: Page, testid: string, nth = 0): Promise<void> {
  const before = (await houseState(page))?.sheet;
  await expect(async () => {
    await page.getByTestId(testid).nth(nth).tap();
    expect((await houseState(page))?.sheet).not.toBe(before);
  }).toPass(slow);
}

test('residents: move my squishy into the Snug, see it in the roster, then move it out', async ({
  browser,
}) => {
  test.setTimeout(300_000); // several scene builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('resident'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const moves: { key: string | undefined; body: unknown }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/house/residents')) {
      moves.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    }
  });
  await patchAndHome(page);
  const shortcut = page.getByTestId('home-house-shortcut');
  await slowExpect(shortcut).toBeVisible();
  await shortcut.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  expect((await houseState(page))?.scene?.residents).toBe(0);

  // The open sheet: the Snug's two beds, both empty, then Grow the house.
  const beds = page.getByTestId('house-bed');
  await page.getByTestId('house-peek-handle').tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('open');
  await expect(page.getByTestId('house-room-snug')).toHaveText('The Snug · 0 of 2 beds');
  // One room: its bed line is the only heading (the peek line steps aside while open).
  await expect(page.getByTestId('house-peek-line')).toBeHidden();
  await expect(beds).toHaveCount(2);
  await expect(beds.first()).toHaveAttribute('data-kind', 'empty');
  await expect(beds.first()).toHaveText(/Move in/);
  await expectRoomyLabels(page, '[data-testid="house-bed"], [data-testid="house-grow-open"]');

  // An empty bed opens the picker: who moves in, with focus on its ✕.
  await tapInSheet(page, 'house-bed');
  expect(await houseState(page)).toMatchObject({ sheet: 'picker', pickRoom: 'snug' });
  await expect(page.getByTestId('house-picker-title')).toHaveText('Who moves into the Snug?');
  await expect(page.getByTestId('house-picker-line')).toHaveText('2 beds free');
  await expect.poll(() => focused(page), slow).toBe('house-picker-close');
  await expect(page.getByTestId('house-scrim')).toBeVisible();
  const pick = page.getByTestId('house-pick');
  await expect(pick).toHaveCount(1);
  await expect(pick).toHaveAttribute('data-kind', 'in');
  const squishyId = (await pick.getAttribute('data-squishy'))!;
  const name = (await pick.locator('.house-pick-name').textContent())!;
  await expectRoomyLabels(page, '[data-testid="house-pick"], [data-testid="house-picker-close"]');

  // One tap moves it in: the ta-da line, the sheet back on the beds, and the
  // squishy drawn in its room.
  await pick.tap();
  const note = page.getByTestId('house-note');
  await expect(note).toHaveText(`${name} moved into the Snug! 🏠`, slow);
  await expect(note).not.toHaveClass(/house-note-calm/);
  expect((await houseState(page))?.sheet).toBe('open');
  await expect.poll(async () => (await houseState(page))?.scene?.residents, slow).toBe(1);
  await expect(page.getByTestId('house-room-snug')).toHaveText('The Snug · 1 of 2 beds');
  await expect(beds.first()).toHaveAttribute('data-kind', 'home');
  await expect(beds.first()).toHaveAttribute('data-squishy', squishyId);
  await expect(beds.first()).toContainText(name);
  expect(moves).toHaveLength(1);
  expect(moves[0]!.body).toEqual({ squishyId, roomId: 'snug' });
  expect(moves[0]!.key).toMatch(/^[0-9a-f]{32}$/);

  // Home, and the roster shows it lives in the house.
  await page.getByTestId('house-back').tap();
  await expect.poll(async () => (await homeState(page))?.open, slow).toBe(true);
  await openRoster(page);
  const row = page.locator(`[data-testid="roster-row"][data-squishy="${squishyId}"]`);
  await expect(row.getByTestId('roster-resident')).toHaveText('🏠');
  await row.getByTestId('roster-head').tap();
  await expect(row.getByTestId('roster-house-line')).toHaveText('🏠 Lives in the Snug');
  await expect(row.getByTestId('roster-house-out')).toBeVisible();
  await closeRoster(page);

  // Back inside: the resident's bed opens its detail, and Move out asks first.
  await shortcut.tap();
  await expect.poll(async () => (await houseState(page))?.pose, slow).toBe('dollhouse');
  await expect.poll(async () => (await houseState(page))?.scene?.residents, slow).toBe(1);
  await page.getByTestId('house-peek-handle').tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('open');
  await expect(async () => {
    await beds.first().tap();
    await expect(page.getByTestId('house-bed-detail')).toBeVisible({ timeout: 1_000 });
  }).toPass(slow);
  await page.getByTestId('house-move-out').tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('move-out');
  await expect(page.getByTestId('house-move-out-ask')).toHaveText(
    'Move them out? They can move back in after a\u00A0day.',
  );
  await expect.poll(() => focused(page), slow).toBe('house-move-out-yes');
  await page.getByTestId('house-move-out-yes').tap();
  await expect(note).toHaveText(`${name} moved out. See you soon! 👋`, slow);
  await expect.poll(async () => (await houseState(page))?.scene?.residents, slow).toBe(0);
  expect((await houseState(page))?.sheet).toBe('open');
  await expect(beds.first()).toHaveAttribute('data-kind', 'empty');
  expect(moves[1]!.body).toEqual({ squishyId, roomId: null });
  expect(moves[1]!.key).not.toBe(moves[0]!.key);

  // The picker shows it can't come back yet; a tap on the dimmed row does nothing.
  await beds.first().tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('picker');
  await expect(pick).toHaveAttribute('data-kind', 'cooldown');
  await expect(pick).toHaveAttribute('aria-disabled', 'true');
  await expect(pick.getByTestId('house-pick-reason')).toHaveText(
    'Can move back in 24\u00A0hours\u00A0🏠',
  );
  await pick.tap({ force: true });
  await page.waitForTimeout(500);
  expect(moves).toHaveLength(2);
  expect((await houseState(page))?.sheet).toBe('picker');

  // From the roster, "Move into the house" opens the picker on that squishy.
  await page.getByTestId('house-picker-close').tap();
  await page.getByTestId('house-back').tap();
  await expect.poll(async () => (await homeState(page))?.open, slow).toBe(true);
  await openRoster(page);
  await row.getByTestId('roster-head').tap();
  await expect(row.getByTestId('roster-resident')).toHaveCount(0);
  await row.getByTestId('roster-house-in').tap();
  await expect.poll(async () => (await houseState(page))?.sheet, slow).toBe('picker');
  expect((await houseState(page))?.pickRoom).toBe('snug');
  await expect(page.getByTestId('roster')).toBeHidden();
  await expect(pick).toHaveClass(/house-pick-focus/);
  await expect(pick.getByTestId('house-pick-reason')).toHaveText(
    'Can move back in 24\u00A0hours\u00A0🏠',
  );
  expect(errors).toEqual([]);
});
