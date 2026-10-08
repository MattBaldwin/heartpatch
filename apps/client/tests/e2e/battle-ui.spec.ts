import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { expectRoomyLabels, freshResize, holdResizes, still, turnLikeIos } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap, realTapAt } from './touch.js';
import { trayButton } from './trays.js';

/**
 * The battle screen's HUD and the bug-bash fixes (owner decision 2026-10-05,
 * the Storybook Diorama's HUD): every action lands on one real tap (down, a
 * hold, up) and on one mouse click; the pills, sheet and result card fit the
 * screen with their text clear of every edge; the Team and Jobs row is back
 * after a battle (#132); the result card fits an iPhone (#133); a nickname
 * shows on the pill and the Swap button (#141); the Heart Charm button says
 * how many are in the bag (#143); and a double tap on the tile chip's × never
 * starts a battle (#137).
 */

interface BattleDebug {
  id: string;
  status: string;
  turn: number;
  phase: 'turn' | 'replace' | 'over';
  pending: number;
  waiting: boolean;
  charms: number | null;
  scene: { squishies: number; camera: Point3 | null } | null;
  /** The band (fractions of the height) the camera fits the fight into. */
  safe: { top: number; bottom: number };
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');

/** The map camera's own state (`MapCameraState`): what a leaked pan or wheel would move. */
interface MapCamera {
  target: { x: number; z: number };
  distance: number;
}

async function settled(page: Page): Promise<BattleDebug> {
  await expect
    .poll(() => battleState(page), { timeout: 30_000 })
    .toMatchObject({ pending: 0, waiting: false });
  return (await battleState(page))!;
}

/** The controls the sheet shows and the pills: words never touch an edge, nothing hangs off screen. */
const HUD_CONTROLS = [
  '.battle-plate',
  '.battle-plate-status',
  '.battle-leave',
  '.battle-button',
  '.battle-caption',
  '.battle-hint',
].join(', ');

// Every test opens its own player (newPlayer); a page left mid-battle keeps
// drawing the arena, which starves the next test's page when rendering is in
// software. Close them all when the test is done.
test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('one real tap works every battle action, and the HUD fits the screen', async ({ browser }) => {
  test.setTimeout(240_000); // a map build and a battle; CI renders in software
  const page = await newPlayer(browser, uniqueName('tapfight'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Tap Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.getByTestId('map-hud')).toContainText('Tap Patch');
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;

  // Name the starter (#141): the pill and the Swap button use it.
  const care = await api<{ squishies: { id: string }[] }>(page, 'GET', `/maps/${mapId}/care`);
  const starter = care.body.squishies[0]!;
  expect(
    (
      await api(page, 'POST', `/maps/${mapId}/squishies/${starter.id}/rename`, {
        nickname: 'Pickle',
      })
    ).status,
  ).toBe(200);

  // A second squishy to swap with (dev), then a fight: one real tap each.
  await realTap(await trayButton(page, 'battle-dev-grant'));
  await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  await realTap(await trayButton(page, 'battle-dev-fight'));
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible();
  let state = await settled(page);
  expect(state).toMatchObject({ status: 'active', turn: 0, phase: 'turn' });

  // The pills, the sheet and its buttons keep their words inside, on screen.
  await expectRoomyLabels(page, HUD_CONTROLS);
  const sheet = (await page.getByTestId('battle-sheet').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(sheet.height).toBeLessThanOrEqual(viewport.height * 0.35 + 1);
  const mine = (await page.getByTestId('battle-plate-mine').boundingBox())!;
  const theirs = (await page.getByTestId('battle-plate-theirs').boundingBox())!;
  expect(mine.y + mine.height).toBeLessThan(sheet.y);
  expect(theirs.y + theirs.height).toBeLessThan(sheet.y);

  // The nickname shows (#141)...
  const plates = [page.getByTestId('battle-plate-mine'), page.getByTestId('battle-plate-theirs')];
  await expect(plates[0]!.or(plates[1]!).filter({ hasText: 'Pickle' })).toHaveCount(1);
  // ...and the Heart Charm button counts the bag (#143): Sprout's 3.
  await expect(page.getByTestId('battle-capture')).toHaveText('Use Heart Charm (3)');
  expect(state.charms).toBe(3);

  // One real tap on a move plays the turn.
  await realTap(page.getByTestId('battle-move').first());
  state = await settled(page);
  expect(state.turn).toBe(1);

  // A drag and a wheel across the fight itself (kids poke the squishies) never
  // reach the canvas, where the map camera listens: the HUD's shield takes them,
  // and the map camera (which a leaked pan or wheel would move) stays put. The
  // battle's own camera isn't compared: the director overwrites the stage
  // camera every frame, and its framing breathes with the fighters' idle sway.
  await page.evaluate(() => {
    const game = document.querySelector('#game');
    const w = window as unknown as { __canvasGestures: number };
    w.__canvasGestures = 0;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) {
      game?.addEventListener(type, () => {
        w.__canvasGestures += 1;
      });
    }
  });
  const before = (await hook<MapCamera>(page, 'camera'))!;
  const mineBox = (await page.getByTestId('battle-plate-mine').boundingBox())!;
  const sheetBox = (await page.getByTestId('battle-sheet').boundingBox())!;
  const yMid = (mineBox.y + mineBox.height + sheetBox.y) / 2;
  const vw = page.viewportSize()!.width;
  await page.mouse.move(vw * 0.2, yMid);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(vw * (0.2 + 0.075 * i), yMid - i * 4);
  await page.mouse.up();
  // A wheel too, where there is one (mobile WebKit has no mouse wheel).
  if (!test.info().project.use.isMobile) await page.mouse.wheel(0, 240);
  expect(
    await page.evaluate(() => (window as unknown as { __canvasGestures: number }).__canvasGestures),
  ).toBe(0);
  await page.waitForTimeout(1500); // a fling would have glided by now
  const after = (await hook<MapCamera>(page, 'camera'))!;
  expect(after.target.x).toBeCloseTo(before.target.x, 3);
  expect(after.target.z).toBeCloseTo(before.target.z, 3);
  expect(after.distance).toBeCloseTo(before.distance, 3);

  // One mouse click (a laptop) on Swap, if someone is on the bench and we can still act:
  // it asks who comes out (#214), then a click on the name swaps.
  if (state.phase === 'turn' && (await page.getByTestId('battle-swap').count()) > 0) {
    const swap = page.getByTestId('battle-swap');
    await expect(swap).toHaveText('Swap');
    // Swap shows inside the sheet, even on a short phone: no scrolling to find it.
    const box = (await swap.boundingBox())!;
    const sheetBox = (await page.getByTestId('battle-sheet').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height + 0.5);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const pick = page.getByTestId('battle-swap-pick').first();
    await expect(pick).toBeVisible();
    const pickBox = (await pick.boundingBox())!;
    await page.mouse.click(pickBox.x + pickBox.width / 2, pickBox.y + pickBox.height / 2);
    state = await settled(page);
    expect(state.turn).toBe(2);
  }

  // Run away asks first; one real tap on each.
  if (state.phase === 'turn') {
    await realTap(page.getByTestId('battle-run'));
    await expectRoomyLabels(page, '.battle-button, .battle-ask');
    await realTap(page.getByTestId('battle-run-confirm'));
    state = await settled(page);
    expect(state.status).toBe('finished');
    const result = page.getByTestId('battle-result');
    await expect(result).toBeVisible();
    await expectRoomyLabels(page, '.battle-result .battle-button, .battle-xp li');
    // The card fits the phone with its gutters (#133).
    const card = (await result.boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(16);
    expect(card.x + card.width).toBeLessThanOrEqual(viewport.width - 16);
    await realTap(page.getByTestId('battle-done'));
  } else {
    // Our squishy got tuckered out first: pick who comes out, then leave.
    await realTap(page.getByTestId('battle-replace').first());
    await settled(page);
    await realTap(hud.getByRole('button', { name: 'Back to patch' }));
  }
  await expect(hud).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Tap Patch');

  // Back on the patch, the Team and Jobs row is there again (#132).
  await expect(await trayButton(page, 'team-open')).toBeVisible();
  await expect(page.getByTestId('jobs-open')).toBeVisible();
  await page.keyboard.press('Escape');

  expect(errors).toEqual([]);
});

test('a double tap on the tile chip’s × never starts a battle', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('dbl'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Double Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  const hintOk = page.getByTestId('tray-hint-ok');
  if (await hintOk.isVisible()) await realTap(hintOk);

  // Tap the middle of the map: a tile chip opens.
  const box = (await page.locator('#game').boundingBox())!;
  await realTapAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  const close = (await panel.getByRole('button', { name: 'Close' }).boundingBox())!;
  const x = close.x + close.width / 2;
  const y = close.y + close.height / 2;
  // Two quick taps where the × was (kids do): the chip closes, nothing else happens.
  // (The second tap lands on whatever is under the × once the chip has
  // closed, maybe a tile, so only "no battle" is asserted after it.)
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(1500);
  expect(await battleState(page)).toBeNull();
  await expect(page.getByTestId('battle-hud')).toBeHidden();
});

test('the fight keeps its safe band when the phone turns (#263)', async ({ browser }) => {
  test.setTimeout(240_000); // a map build and a battle; CI renders in software
  const page = await newPlayer(browser, uniqueName('turnfight'));
  await holdResizes(page);
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Turn Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await realTap(await trayButton(page, 'battle-dev-fight'));
  await expect(page.getByTestId('battle-hud')).toBeVisible();
  await settled(page);
  // The camera has measured the band for this shape of screen.
  const before = (await battleState(page))!.safe;

  // The band under the pills and above the sheet, once the turned layout
  // has settled: what a resize heard now would measure afresh.
  const band = async () => {
    await still(page, '.battle-plate, [data-testid="battle-sheet"]');
    return (await battleState(page))!.safe;
  };
  await turnLikeIos(page);
  const turned = await band();
  await freshResize(page);
  const fresh = await band();
  expect(turned.top).toBeCloseTo(fresh.top, 3);
  expect(turned.bottom).toBeCloseTo(fresh.bottom, 3);
  // The pills take a bigger share of a short screen: the band did move.
  expect(fresh.top).not.toBeCloseTo(before.top, 2);
});
