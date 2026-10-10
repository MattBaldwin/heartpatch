import { GAME_DATA, type MapView } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { hook } from './dev-hook.js';
import { expectRoomyLabels, settled, still } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { touch, type Point } from './touch.js';
import { openTray, traysState, traySettled, type TraySide } from './trays.js';

// Every map control stays on screen and in reach on short screens too (#136:
// on an iPhone on its side, the old button column ran off the top, and an
// open tray hid its last rows below the fold). Measured as boxes, not pixels.

const SHORT_SCREENS = [
  { name: 'iPhone landscape', width: 844, height: 390 },
  { name: 'iPhone SE landscape', width: 667, height: 375 },
  { name: 'iPhone portrait', width: 390, height: 844 },
  { name: 'iPhone SE portrait', width: 375, height: 667 },
  { name: 'iPad landscape', width: 1180, height: 820 },
  { name: 'iPad portrait', width: 820, height: 1180 },
] as const;

/** The map's own controls while no tray is open. */
const HUD = [
  '[data-testid^="tray-handle-"]',
  '[data-testid="lobby-open"]',
  '[data-testid="chat-open"]',
  '[data-testid="keeper-menu"]',
].join(', ');

/** A tray's rows a player uses (the dev-only grant buttons may scroll). */
const ROWS = [
  '.tray-section > button',
  '.tray-section > .battle-entry-box > button:not([data-testid^="battle-dev-"])',
  '.tray-jobs .jobs-entry > button',
].join(', ');

const mapState = (page: Page) => hook<{ selected: string | null }>(page, 'map');
const zoom = async (page: Page) => (await hook<{ distance: number }>(page, 'camera'))?.distance;

type Box = { id: string; l: number; t: number; r: number; b: number };

/** The boxes of the visible elements matching `selector`, as drawn. */
async function boxes(page: Page, selector: string): Promise<Box[]> {
  await settled(page);
  await still(page, selector);
  return page.evaluate((selector) => {
    const out: Box[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('[hidden]') || el.closest('[inert]')) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const id = el.dataset['testid'] ?? el.className;
      out.push({ id, l: b.left, t: b.top, r: b.right, b: b.bottom });
    }
    return out;
  }, selector);
}

const overlap = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const inside = (a: Box, b: Box) =>
  a.l >= b.l - 0.5 && a.t >= b.t - 0.5 && a.r <= b.r + 0.5 && a.b <= b.b + 0.5;
const show = (a: Box) => `${a.id} ${JSON.stringify([a.l, a.t, a.r, a.b].map(Math.round))}`;

/** On screen, at least 44 px each way, and clear of each other. */
function expectReachable(list: Box[], screen: Box): void {
  const problems: string[] = [];
  for (const [i, a] of list.entries()) {
    if (!inside(a, screen)) problems.push(`${show(a)} is off screen`);
    if (a.r - a.l < 43.5 || a.b - a.t < 43.5) problems.push(`${show(a)} is under 44 px`);
    for (const b of list.slice(i + 1)) {
      if (overlap(a, b)) problems.push(`${show(a)} overlaps ${show(b)}`);
    }
  }
  expect(problems).toEqual([]);
}

/**
 * A pinch with one finger on each map control and the other on the map
 * zooms, and opens nothing (#159: a finger on a button turned the pinch into
 * a pan). The button finger rests, as a thumb holding the phone does; the
 * map finger spreads away from it, then back.
 */
async function pinchFromControls(page: Page, hud: Box[], screen: Box): Promise<void> {
  const mid = { x: screen.r / 2, y: screen.b / 2 };
  for (const control of hud) {
    const thumb = { x: (control.l + control.r) / 2, y: (control.t + control.b) / 2 };
    // Away from the thumb, from near the middle of the screen.
    const len = Math.hypot(mid.x - thumb.x, mid.y - thumb.y);
    const away = { x: (mid.x - thumb.x) / len, y: (mid.y - thumb.y) / len };
    const reach = Math.min(screen.r, screen.b) / 5;
    const finger = (k: number): Point => ({ x: mid.x + away.x * k, y: mid.y + away.y * k });
    const spread = (from: number, to: number) =>
      Array.from({ length: 9 }, (_, i) => ({
        1: thumb,
        2: finger(from + ((to - from) * i) / 8),
      }));
    const before = await zoom(page);
    await touch(page, spread(-reach, reach), { hitTest: true });
    const zoomedIn = await zoom(page);
    expect(zoomedIn, `pinch out from ${control.id}`).toBeLessThan(before! * 0.9);
    await touch(page, spread(reach, -reach), { hitTest: true });
    expect(await zoom(page), `pinch in from ${control.id}`).toBeGreaterThan(zoomedIn! * 1.1);
    expect((await traysState(page))?.open ?? null, `${control.id} opened a tray`).toBeNull();
    expect((await mapState(page))?.selected ?? null, `${control.id} picked a tile`).toBeNull();
    const sheets = await boxes(page, '[role="dialog"]');
    expect(sheets.map(show), `${control.id} opened a sheet`).toEqual([]);
  }
}

/** Every row of the open tray is in its body's view without scrolling. */
async function checkTray(page: Page, side: TraySide, screen: Box): Promise<void> {
  await openTray(page, side);
  await traySettled(page, side);
  const tray = page.getByTestId(`tray-${side}`);
  await expect(tray.locator('.tray-body')).toHaveJSProperty('scrollTop', 0);
  const view = (await boxes(page, `[data-testid="tray-${side}"] .tray-body`))[0]!;
  const rows = await boxes(page, `[data-testid="tray-${side}"] :is(${ROWS})`);
  expect(rows.length).toBeGreaterThan(1);
  const hidden = rows.filter((row) => !inside(row, view)).map(show);
  expect(hidden, `rows below the fold of ${show(view)}`).toEqual([]);
  // Narrower rows side by side still keep their words off the edges.
  await expectRoomyLabels(page, `[data-testid="tray-${side}"] :is(${ROWS})`);
  // The handle it carries and the close button stay reachable; the corner
  // buttons stay clear of the tray.
  const controls = await boxes(
    page,
    `[data-testid="tray-handle-${side}"], [data-testid="tray-${side}"] .tray-close`,
  );
  expectReachable(controls, screen);
  const trayBox = (await boxes(page, `[data-testid="tray-${side}"]`))[0]!;
  const corners = await boxes(
    page,
    '[data-testid="lobby-open"], [data-testid="chat-open"], [data-testid="keeper-menu"]',
  );
  expect(corners.filter((c) => overlap(c, trayBox)).map(show)).toEqual([]);
  await tray.locator('.tray-close').tap();
  await expect.poll(async () => (await traysState(page))?.open).toBeNull();
  await expect(tray).not.toHaveClass(/tray-shown/);
}

test('the map’s controls fit short and tall screens', async ({ browser }) => {
  test.setTimeout(300_000); // six screens; CI renders in software
  const page = await newPlayer(browser, uniqueName('short'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Short Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();
  await expect(page.getByTestId('tray-hint')).toBeHidden();

  for (const size of SHORT_SCREENS) {
    await test.step(size.name, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const screen: Box = { id: 'screen', l: 0, t: 0, r: size.width, b: size.height };

      const hud = await boxes(page, HUD);
      expect(hud.map((b) => b.id).sort()).toEqual([
        'chat-open',
        'keeper-menu',
        'lobby-open',
        'tray-handle-adventure',
        'tray-handle-heartpatch',
      ]);
      expectReachable(hud, screen);
      await pinchFromControls(page, hud, screen);

      for (const side of ['adventure', 'heartpatch'] as const) {
        await checkTray(page, side, screen);
      }

      // A picked tile's panel sits clear of every map control.
      // Right after a resize the map can miss a tap while it catches up, so
      // tap again only while nothing is picked: a second tap on the picked
      // Heart Seed would open Home.
      const game = (await page.locator('#game').boundingBox())!;
      const panel = page.getByTestId('tile-panel');
      await expect(async () => {
        if ((await mapState(page))?.selected == null) {
          await tapCanvas(page, game.width / 2, game.height / 2);
        }
        await expect(panel).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      const panelBox = (await boxes(page, '[data-testid="tile-panel"]'))[0]!;
      expect(inside(panelBox, screen), show(panelBox)).toBe(true);
      // Its own controls fit it without scrolling (#138: "Go home" stuck out
      // of the bottom on a phone on its side).
      const panelControls = await boxes(page, '[data-testid="tile-panel"] button');
      expect(panelControls.length).toBeGreaterThan(0);
      const cut = panelControls.filter((c) => !inside(c, panelBox)).map(show);
      expect(cut, `cut off by the tile panel ${show(panelBox)}`).toEqual([]);
      const under = (await boxes(page, HUD)).filter((c) => overlap(c, panelBox)).map(show);
      expect(under, `under the tile panel ${show(panelBox)}`).toEqual([]);
      await panel.getByRole('button', { name: 'Close' }).tap();
      await expect(panel).toBeHidden();
    });
  }
});

test('a busy tile’s five buttons fit a phone on its side (#264)', async ({ browser }) => {
  test.setTimeout(240_000); // a map build at two sizes; CI renders in software
  const page = await newPlayer(browser, uniqueName('busy'));
  // A wild squishy on my home tile that has a node, every time (spawns are
  // rolled per window): its panel has all five buttons, Send a gatherer,
  // Meet it, Gather, Go home and Explore (#199).
  let busy: { q: number; r: number } | null = null;
  await page.route('**/api/v1/maps/*/wild', async (route) => {
    const mapId = /\/maps\/([^/]+)\/wild/.exec(route.request().url())![1]!;
    const view = (await (await page.request.get(`/api/v1/maps/${mapId}/view`)).json()) as MapView;
    const me = view.members[0]!;
    // A node with no season: a seasonal node on home land sleeps out of its
    // season, with no Gather (owner decision 2026-10-06), so the test mustn't
    // hang on the calendar. The home ring always has Timber, Stone, Emberwood
    // and Treats (#288).
    const tile = view.tiles.find((t) => {
      const resource = GAME_DATA.resources.find((r) => r.id === t.nodeResource);
      return (
        t.homeSlot === me.homeSlot &&
        t.ownerUserId === me.user.id &&
        resource?.gather !== undefined &&
        resource.season === undefined
      );
    })!;
    busy = { q: tile.q, r: tile.r };
    const response = await route.fetch();
    const body = (await response.json()) as { wild: { tiles: { q: number; r: number }[] } };
    if (!body.wild.tiles.some((t) => t.q === tile.q && t.r === tile.r)) body.wild.tiles.push(busy);
    await route.fulfill({ response, json: body });
  });
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Busy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();
  await expect.poll(() => busy).not.toBeNull();
  const key = `${String(busy!.q)},${String(busy!.r)}`;

  const wildState = () =>
    hook<{ selected: string | null; wild: { key: string; x: number; y: number }[] }>(page, 'map');
  const panel = page.getByTestId('tile-panel');
  for (const size of [
    { width: 667, height: 375 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    // Right after a resize the map can miss a tap: tap again only while the
    // tile isn't picked.
    await expect(async () => {
      const state = await wildState();
      if (state?.selected !== key) {
        const tuft = state?.wild.find((w) => w.key === key);
        if (!tuft) throw new Error(`no tuft on ${key} yet`);
        await tapCanvas(page, tuft.x, tuft.y);
      }
      await expect(panel.getByTestId('tile-meet-wild')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    // Gather and Go home render once the bag and home data arrive, which can
    // be after Meet it: wait for all five before measuring.
    for (const id of ['tile-send-gatherer', 'tile-gather', 'tile-home', 'tile-explore']) {
      await expect(panel.getByTestId(id)).toBeVisible();
    }
    const panelBox = (await boxes(page, '[data-testid="tile-panel"]'))[0]!;
    const buttons = await boxes(page, '[data-testid="tile-panel"] .tile-panel-actions button');
    expect(buttons.length, 'Send a gatherer, Meet it, Gather, Go home and Explore').toBe(5);
    const cut = buttons.filter((b) => !inside(b, panelBox)).map(show);
    expect(cut, `cut off by the tile panel ${show(panelBox)}`).toEqual([]);
    await expect(panel).toHaveJSProperty('scrollTop', 0);
    expect(
      await panel.evaluate((p) => p.scrollHeight <= p.clientHeight + 1),
      'the panel scrolls',
    ).toBe(true);
    // Go home and Explore share a row, one line each (#291).
    const home = buttons.find((b) => b.id === 'tile-home')!;
    const explore = buttons.find((b) => b.id === 'tile-explore')!;
    expect(Math.abs(home.t - explore.t), `${show(home)} and ${show(explore)}`).toBeLessThan(2);
    for (const id of ['tile-home', 'tile-explore']) {
      const oneLine = await panel.getByTestId(id).evaluate((b) => {
        const lineHeight = parseFloat(getComputedStyle(b).lineHeight) || 24;
        const pad =
          parseFloat(getComputedStyle(b).paddingTop) +
          parseFloat(getComputedStyle(b).paddingBottom);
        return b.scrollWidth <= b.clientWidth && b.clientHeight - pad < lineHeight * 1.6;
      });
      expect(oneLine, `${id} on one line`).toBe(true);
    }
    await panel.getByRole('button', { name: 'Close' }).tap();
    await expect(panel).toBeHidden();
  }
});
