import { expect, test, type Page } from '@playwright/test';
import { api, draws, hook, idle } from './dev-hook.js';
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
  breathing: 'live' | 'stopped';
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

/** Waits until nothing is drawn for `quietMs` and the loop reports idle (see smoke.spec.ts). */
async function waitForIdle(page: Page, quietMs = 500): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await draws(page);
        await page.waitForTimeout(quietMs);
        const isIdle = await idle(page);
        return isIdle && (await draws(page)) === before;
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true);
}

/** The controls the sheet shows and the pills: words never touch an edge, nothing hangs off screen. */
const HUD_CONTROLS = [
  '.battle-plate',
  '.battle-plate-status',
  '.battle-top > .hp-close',
  '[data-testid="battle-sheet"] .hp-button',
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

  // CI renders in software, a frame every second or so, each one holding the
  // page: far too slow to breathe. Breathing stops for this battle and the
  // arena, waiting on a pick, draws nothing on its own, so taps (and other
  // pages on the same GPU) aren't starved (#397).
  await expect
    .poll(async () => (await battleState(page))?.breathing, { timeout: 30_000 })
    .toBe('stopped');
  // The same slow frames that stop breathing feed the resolution governor,
  // which can step the tier or scale on the last of them; that change is
  // applied, and drawn (a reload and its settle frames, the arena's new
  // detail level), after the verdict. Let those finish, then count.
  await waitForIdle(page);
  const drawn = await draws(page);
  await page.waitForTimeout(2_000); // a breathing arena would draw at least once
  expect(await draws(page)).toBe(drawn);

  // The pills, the sheet and its buttons keep their words inside, on screen.
  await expectRoomyLabels(page, HUD_CONTROLS);
  const sheet = (await page.getByTestId('battle-sheet').boundingBox())!;
  const viewport = page.viewportSize()!;
  // The camera keeps clear exactly the share the sheet may take.
  expect(sheet.y).toBeGreaterThanOrEqual(viewport.height * state.safe.bottom - 1);
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
    await expectRoomyLabels(page, '[data-testid="battle-sheet"] .hp-button, .battle-ask');
    await realTap(page.getByTestId('battle-run-confirm'));
    state = await settled(page);
    expect(state.status).toBe('finished');
    const result = page.getByTestId('battle-result');
    await expect(result).toBeVisible();
    await expectRoomyLabels(page, '.battle-result .hp-button, .battle-xp li');
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
  const page = await newPlayer(browser, uniqueName('turnbt'));
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
  // The camera reads the band once more before the layout turns (a frame
  // drawn in between does the same), so a stale one stays cached unless
  // something measures again after the turn.
  await turnLikeIos(page, async () => {
    await battleState(page);
  });
  const turned = await band();
  await freshResize(page);
  const fresh = await band();
  expect(turned.top).toBeCloseTo(fresh.top, 3);
  expect(turned.bottom).toBeCloseTo(fresh.bottom, 3);
  // The pills take a bigger share of a short screen: the band did move.
  expect(fresh.top).not.toBeCloseTo(before.top, 2);
});

/** Phones and a tablet the battle sheet must hold every control and the prompt on. */
const SHEET_SCREENS: readonly { name: string; width: number; height: number; inset?: Inset }[] = [
  { name: 'iPhone SE', width: 375, height: 667, inset: { top: 20, bottom: 0 } },
  { name: 'iPhone 15', width: 393, height: 852 },
  {
    name: 'iPhone 15 with its island and home bar',
    width: 393,
    height: 852,
    inset: { top: 59, bottom: 34 },
  },
  { name: 'iPhone Pro Max', width: 430, height: 932 },
  { name: 'iPad portrait', width: 768, height: 1024 },
  { name: 'iPad with its home bar', width: 834, height: 1194, inset: { top: 0, bottom: 20 } },
  { name: 'iPhone landscape', width: 844, height: 390 },
];

/** A device's safe-area insets in px, simulated through Chromium (WebKit has no such switch, so those cases only run there). */
interface Inset {
  top: number;
  bottom: number;
}

/** Run away, the prompt and every control in the sheet sit inside the screen, tall enough to tap. */
async function expectSheetFits(
  page: Page,
  label: string,
  inset: Inset = { top: 0, bottom: 0 },
  tipShows = false,
): Promise<void> {
  const { width, height } = page.viewportSize()!;
  await still(
    page,
    '[data-testid="battle-sheet"], [data-testid="battle-capture-hint"], .battle-plate',
  );
  const inside =
    '[data-testid="battle-caption"], [data-testid="battle-capture-hint"], [data-testid="battle-sheet"] .hp-button';
  const boxes = await page.evaluate((selector) => {
    const sheet = document.querySelector<HTMLElement>('[data-testid="battle-sheet"]')!;
    return {
      plateTop: document.querySelector('.battle-plate')!.getBoundingClientRect().top,
      plateBottom: document.querySelector('.battle-plate')!.getBoundingClientRect().bottom,
      sheetTop: sheet.getBoundingClientRect().top,
      scrolls: sheet.scrollHeight - sheet.clientHeight,
      // The tip is always in the page; only a drawn one has a box.
      items: [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => {
          const b = node.getBoundingClientRect();
          return {
            id: node.dataset['testid'] ?? node.className,
            // A line of words that doesn't fit its own box has its end cut off.
            cut: node.scrollHeight - node.clientHeight,
            l: b.left,
            t: b.top,
            r: b.right,
            b: b.bottom,
          };
        }),
    };
  }, inside);
  // The prompt line is there, not dropped, and so is Run away.
  const ids = boxes.items.map((item) => item.id);
  expect(ids, label).toContain('battle-caption');
  expect(ids, label).toContain('battle-run');
  // The tip is measured when the bag is empty (and only then), so a missed mock can't pass.
  expect(ids.includes('battle-capture-hint'), `${label}: the craft tip`).toBe(tipShows);
  expect(boxes.scrolls, `${label}: the sheet scrolls`).toBeLessThanOrEqual(0);
  expect(boxes.plateTop, `${label}: the pills start below the top inset`).toBeGreaterThanOrEqual(
    inset.top,
  );
  for (const item of boxes.items) {
    const where = `${label}: ${item.id}`;
    expect(item.l, where).toBeGreaterThanOrEqual(0);
    expect(item.t, where).toBeGreaterThanOrEqual(0);
    expect(item.r, where).toBeLessThanOrEqual(width);
    expect(item.b, where).toBeLessThanOrEqual(height - inset.bottom);
    expect(item.cut, `${where} is cut off`).toBeLessThanOrEqual(0);
    if (item.id === 'battle-capture-hint') {
      // The tip floats over the fight, clear of the sheet's controls and the pills.
      expect(item.b, `${where} stays above the sheet`).toBeLessThanOrEqual(boxes.sheetTop + 1);
      expect(item.t, `${where} stays below the pills`).toBeGreaterThanOrEqual(boxes.plateBottom);
    } else if (item.id !== 'battle-caption') {
      expect(item.b - item.t, where).toBeGreaterThanOrEqual(44);
    }
  }
}

const SHEET_CASES = [
  { name: '', bench: false, noCharms: false, fourMoves: false },
  { name: ' with a Swap button', bench: true, noCharms: false, fourMoves: false },
  {
    name: ' with no Heart Charms (the craft tip shows)',
    bench: false,
    noCharms: true,
    fourMoves: false,
  },
  { name: ' with four moves and a Swap button', bench: true, noCharms: false, fourMoves: true },
] as const;

/**
 * Puts a squishy that knows four moves (a Splashmallow) at the front of the
 * team, so the next fight's pick is the biggest the sheet has to fit (#656).
 */
async function leadWithFourMoves(page: Page, mapId: string): Promise<void> {
  const granted = await api<{ squishy: { id: string } }>(
    page,
    'POST',
    `/maps/${mapId}/dev/squishies`,
    {
      speciesId: 'splashmallow',
      level: 30,
    },
  );
  expect(granted.status).toBe(201);
  const care = await api<{ squishies: { id: string }[] }>(page, 'GET', `/maps/${mapId}/care`);
  const others = care.body.squishies
    .map((s) => s.id)
    .filter((id) => id !== granted.body.squishy.id);
  const team = await api(page, 'POST', `/maps/${mapId}/team`, {
    squishyIds: [granted.body.squishy.id, ...others.slice(0, 1)],
  });
  expect(team.status).toBe(200);
}

for (const { name, bench, noCharms, fourMoves } of SHEET_CASES) {
  test(`a plain wild battle's controls fit small phones${name}`, async ({ browser }) => {
    test.setTimeout(240_000); // a map build and a battle; CI renders in software
    const page = await newPlayer(
      browser,
      uniqueName(fourMoves ? 'sheet4' : bench ? 'sheetsw' : 'sheetfit'),
    );
    await holdResizes(page);
    if (noCharms) {
      // The bag as it is once the starter's 3 are spent: the count the HUD reads.
      await page.route('**/api/v1/maps/*/inventory', async (route) => {
        const reply = await route.fetch();
        const body = (await reply.json()) as { items: Record<string, number> };
        delete body.items['heart-charm'];
        await route.fulfill({ response: reply, json: body });
      });
    }
    const lobby = page.getByTestId('lobby');
    await lobby.getByRole('button', { name: 'Make a patch' }).tap();
    await lobby.getByLabel('Patch name').fill('Sheet Patch');
    await lobby.getByRole('button', { name: 'Make it!' }).tap();
    await visitPatch(lobby);
    if (bench) {
      await realTap(await trayButton(page, 'battle-dev-grant'));
      await expect(page.locator('.battle-entry-note')).toContainText('joined you');
    }
    if (fourMoves) await leadWithFourMoves(page, (await hook<{ id: string }>(page, 'map'))!.id);
    await realTap(await trayButton(page, 'battle-dev-fight'));
    await expect(page.getByTestId('battle-hud')).toBeVisible();
    await settled(page);
    if (fourMoves) await expect(page.getByTestId('battle-move')).toHaveCount(4);
    if (noCharms) {
      await expect(page.getByTestId('battle-capture-hint')).toContainText('No Heart Charms!');
      // A tap on the tip puts it away; a tap on the dimmed button brings it back,
      // and neither adds a line to the sheet.
      await page.getByTestId('battle-capture-hint').tap();
      await expect(page.getByTestId('battle-capture-hint')).toBeHidden();
      await page.getByTestId('battle-capture').tap();
      await expect(page.getByTestId('battle-capture-hint')).toBeVisible();
      await expect(page.locator('.battle-problem')).toBeEmpty();
      await settled(page);
    }
    const chromium = page.context().browser()?.browserType().name() === 'chromium';
    const cdp = chromium ? await page.context().newCDPSession(page) : null;
    for (const screen of SHEET_SCREENS) {
      if (screen.inset && !cdp) continue;
      const { top, bottom } = screen.inset ?? { top: 0, bottom: 0 };
      await cdp?.send(
        'Emulation.setSafeAreaInsetsOverride' as never,
        {
          insets: { top, bottom, left: 0, right: 0 },
        } as never,
      );
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await freshResize(page);
      await expectSheetFits(page, screen.name, screen.inset, noCharms);
    }
  });
}

// The camera frames the fight above the sheet, so a sheet that grew and shrank
// as a turn played moved the fight with it (#656). Landscape phones and a
// 320 px phone are where the controls leaving changed the sheet the most.
const TURN_SCREENS: readonly { name: string; width: number; height: number }[] = [
  { name: 'iPhone landscape', width: 844, height: 390 },
  { name: 'a 320 px phone', width: 320, height: 568 },
];

for (const screen of TURN_SCREENS) {
  test(`the battle sheet keeps its height while a turn plays on ${screen.name}`, async ({
    browser,
  }) => {
    test.setTimeout(240_000); // a map build and a battle; CI renders in software
    const page = await newPlayer(browser, uniqueName('sheetturn'));
    await holdResizes(page);
    const lobby = page.getByTestId('lobby');
    await lobby.getByRole('button', { name: 'Make a patch' }).tap();
    await lobby.getByLabel('Patch name').fill('Turn Patch');
    await lobby.getByRole('button', { name: 'Make it!' }).tap();
    await visitPatch(lobby);
    await realTap(await trayButton(page, 'battle-dev-grant'));
    await expect(page.locator('.battle-entry-note')).toContainText('joined you');
    await leadWithFourMoves(page, (await hook<{ id: string }>(page, 'map'))!.id);
    await realTap(await trayButton(page, 'battle-dev-fight'));
    await expect(page.getByTestId('battle-hud')).toBeVisible();
    const first = await settled(page);
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await freshResize(page);
    await still(page, '[data-testid="battle-sheet"]');

    // Every height the sheet takes from here on, as the browser lays it out.
    await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="battle-sheet"]')!;
      const seen: number[] = [];
      new ResizeObserver((entries) => {
        for (const entry of entries) seen.push(entry.borderBoxSize[0]?.blockSize ?? 0);
      }).observe(sheet);
      (window as unknown as { sheetHeights: number[] }).sheetHeights = seen;
    });
    const pick = (await page.getByTestId('battle-sheet').boundingBox())!.height;
    // Bubble Bath heals: the wild squishy survives, so the next pick is the same sheet.
    await realTap(page.getByTestId('battle-move').filter({ hasText: 'Bubble Bath' }));
    await expect
      .poll(async () => (await battleState(page))?.turn, { timeout: 30_000 })
      .toBeGreaterThan(first.turn);
    await settled(page);
    await expect(page.getByTestId('battle-move')).toHaveCount(4);
    await still(page, '[data-testid="battle-sheet"]');

    const heights = await page.evaluate(
      () => (window as unknown as { sheetHeights: number[] }).sheetHeights,
    );
    for (const height of heights) expect(Math.abs(height - pick), String(heights)).toBeLessThan(1);
    // The turn played, with the sheet held at the pick's height all the way through.
    expect((await page.getByTestId('battle-sheet').boundingBox())!.height).toBeCloseTo(pick, 0);
  });
}
