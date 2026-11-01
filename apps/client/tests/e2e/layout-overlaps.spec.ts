import { MAP_NAME_MAX_LENGTH } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { selectTile } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { expectClear, settled } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

// Four overlaps the render-checks found on an iPhone SE and an iPad: the 🐾
// button over "My patches", a busy tile panel cut off in a short window, the
// "Log out" chip over the map while the Build sheet is up, and the iPad's tile
// panel over the map's name pill. Then (#721 follow-up) the panel ends between
// rows, and the Build sheet keeps the round Me button, then its Build! row is
// pinned whole and unfaded at the panel's foot. Each is checked on the
// game's own boxes.

/**
 * The widest name a patch can have: the longest allowed, in its widest letter,
 * so the name pill is checked at its widest and can't pass on a short name
 * (it shortens with … in the top row on a phone on its side).
 */
const WIDEST_NAME = 'W'.repeat(MAP_NAME_MAX_LENGTH);

const SE = { width: 375, height: 667 };
const PHONES = [
  { name: 'smallest phone', width: 320, height: 568 },
  { name: 'iPhone SE', ...SE },
  { name: 'iPhone 15', width: 393, height: 852 },
  { name: 'iPhone 16 Pro', width: 402, height: 874 },
  { name: 'iPhone Pro Max', width: 430, height: 932 },
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1080, height: 810 },
] as const;
/** Phones on their side (the trays' landscape query: 520px tall at most). */
const LANDSCAPE_PHONES = [
  { width: 852, height: 393 }, // iPhone 15
  { width: 667, height: 375 }, // iPhone SE
] as const;

/** My tiles (a fresh patch owns only mine). */
async function myTiles(page: Page): Promise<{ q: number; r: number }[]> {
  const map = await hook<{ id: string }>(page, 'map');
  const view = await api<{ tiles: { q: number; r: number; ownerUserId: string | null }[] }>(
    page,
    'GET',
    `/maps/${map!.id}/view`,
  );
  return view.body.tiles.filter((t) => t.ownerUserId !== null);
}

/** Opens a tile's panel, as a tap on it would. */
async function openTile(page: Page, tile: { q: number; r: number }): Promise<void> {
  await selectTile(page, tile);
  await expect(page.getByTestId('tile-panel')).toBeVisible();
}

/** Opens the panel of one of my tiles with a Build button (home's middle has Go home). */
async function openBuildable(page: Page): Promise<void> {
  for (const tile of await myTiles(page)) {
    await openTile(page, tile);
    const build = page.getByTestId('tile-build');
    if (
      await build.waitFor({ timeout: 2_000 }).then(
        () => true,
        () => false,
      )
    )
      return;
  }
  throw new Error('none of my tiles has a Build button');
}

async function openMyTile(page: Page): Promise<void> {
  await openTile(page, (await myTiles(page))[0]!);
}

async function closePanel(page: Page): Promise<void> {
  const panel = page.getByTestId('tile-panel');
  await page.evaluate(() => document.querySelector('[data-testid="busy-rows"]')?.remove());
  await panel.getByRole('button', { name: 'Close' }).tap();
  await expect(panel).toBeHidden();
}

/**
 * A busy tile (roads, a dock, guards, a fire's note): more lines in the panel
 * than any screen holds, with a button last, as a Wild Isle dock's has.
 */
async function makeBusy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const actions = document.querySelector('[data-testid="tile-panel-actions"]')!;
    const extra = document.createElement('div');
    extra.dataset['testid'] = 'busy-rows';
    // A full row, as a feature slot's lines take (on a phone on its side it
    // would otherwise sit beside Go home and Explore and stretch them).
    extra.style.flex = '1 1 100%';
    extra.style.gridColumn = '1 / -1';
    for (let i = 0; i < 14; i++) {
      const line = document.createElement('p');
      line.textContent = `A busy line, number ${String(i + 1)}.`;
      line.style.margin = '0 0 10px';
      extra.append(line);
    }
    const last = document.createElement('button');
    last.type = 'button';
    last.className = 'hp-button hp-button-secondary';
    last.dataset['testid'] = 'busy-last';
    last.textContent = 'Last button';
    extra.append(last);
    actions.append(extra);
  });
}

/**
 * The tile panel never ends through a row: every line and button in it is
 * either whole in sight or wholly below its foot, and while it can scroll
 * further its foot fades ("more below").
 */
async function expectWholeRows(page: Page): Promise<void> {
  await settled(page);
  const fit = await page.getByTestId('tile-panel').evaluate((panel) => {
    const foot = panel.getBoundingClientRect().bottom;
    const sliced = [...panel.querySelectorAll('p, button, .tile-panel-head')]
      .filter((row) => row.closest('.tile-panel-head') === row || !row.closest('.tile-panel-head'))
      .map((row) => ({ text: row.textContent, box: row.getBoundingClientRect() }))
      .filter(({ box }) => box.height > 0 && box.top < foot - 1 && box.bottom > foot + 1)
      .map(({ text }) => text);
    const scrolls = panel.scrollTop + panel.clientHeight < panel.scrollHeight - 2;
    const fade = getComputedStyle(panel, '::after').content !== 'none';
    return { sliced, scrolls, fade };
  });
  expect(fit.sliced).toEqual([]);
  expect(fit.fade).toBe(fit.scrolls);
}

/**
 * The Build sheet's Build! and Not now are pinned whole at the panel's foot,
 * scrolled to the top or the bottom, with no "more below" fade over them
 * (#723 follow-up: the fade washed Build! out, so it read as switched off).
 */
async function expectBuildRow(page: Page, screenHeight: number): Promise<void> {
  const panel = page.getByTestId('tile-panel');
  await checkBuildRow(page, screenHeight);
  // A sheet taller than the panel (a long note, big text): the row stays pinned.
  // A style, not a node: the sheet redraws its children on any change.
  await page.evaluate(() => {
    const tall = document.createElement('style');
    tall.id = 'build-tall';
    tall.textContent = '.build-detail { min-height: 200dvh; }';
    document.head.append(tall);
  });
  await settled(page);
  expect(await panel.evaluate((p) => p.scrollHeight > p.clientHeight + 100)).toBe(true);
  await checkBuildRow(page, screenHeight);
  await page.evaluate(() => document.getElementById('build-tall')?.remove());
}

async function checkBuildRow(page: Page, screenHeight: number): Promise<void> {
  const panel = page.getByTestId('tile-panel');
  for (const to of ['top', 'bottom'] as const) {
    await panel.evaluate((p, end) => {
      p.scrollTop = end === 'top' ? 0 : p.scrollHeight;
    }, to);
    await settled(page);
    const fit = await panel.evaluate((p) => {
      const box = p.getBoundingClientRect();
      const inner = { top: box.top + p.clientTop, bottom: box.top + p.clientTop + p.clientHeight };
      const row = p.querySelector('.build-actions')!.getBoundingClientRect();
      const buttons = ['build-go', 'build-cancel'].map((id) => {
        const b = p.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return { id, top: b.top, bottom: b.bottom, height: b.height };
      });
      return {
        inner,
        row: { top: row.top, bottom: row.bottom },
        buttons,
        more: p.dataset['more'],
        fade: getComputedStyle(p, '::after').content !== 'none',
      };
    });
    expect(fit.more, to).toBe('none');
    expect(fit.fade, to).toBe(false);
    // The row sits on the panel's foot, its buttons whole inside it with room below.
    expect(Math.abs(fit.row.bottom - fit.inner.bottom), to).toBeLessThanOrEqual(1);
    for (const b of fit.buttons) {
      expect(b.height, `${b.id} ${to}`).toBeGreaterThan(0);
      expect(b.top, `${b.id} ${to}`).toBeGreaterThanOrEqual(fit.inner.top);
      expect(b.bottom, `${b.id} ${to}`).toBeLessThanOrEqual(fit.inner.bottom - 8);
      expect(b.bottom, `${b.id} ${to}`).toBeLessThanOrEqual(screenHeight);
    }
  }
}

test('small phones and iPads: nothing sits on anything (#621 render-checks)', async ({
  browser,
}) => {
  // Seven screens, then each phone on its side with its Build sheet; CI renders in software.
  test.setTimeout(480_000);
  const page = await newPlayer(browser, uniqueName('fit'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  // A Wild Isle, as the render-checks were (its home tiles take a Build sheet).
  await lobby.getByTestId('lobby-patch-type-wild-isle').tap();
  await lobby.getByLabel('Patch name').fill(WIDEST_NAME);
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const hint = page.getByTestId('tray-hint-ok');
  if (await hint.isVisible()) await hint.tap();

  for (const screen of PHONES) {
    await test.step(`${screen.name}: the top row`, async () => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      // The 🐾, Chat and Friends never touch "My patches", nor the Keeper menu.
      await expectClear(page, '.tray-top-left > button', '.tray-top-right > button');
      await expectClear(page, '[data-testid="keeper-menu"]', '.tray-top-right > button');
    });
  }

  await test.step('iPhone SE: a busy tile panel has room, and its last button is reachable', async () => {
    await page.setViewportSize(SE);
    await openMyTile(page);
    await makeBusy(page);
    await settled(page);
    const panel = page.getByTestId('tile-panel');
    const box = (await panel.boundingBox())!;
    // Room for close to half the screen (it was a 238px window under the side
    // handles; whole rows may give up one line of its 315px cap), still under
    // the map's name pill and inside the screen.
    expect(box.height).toBeGreaterThan(260);
    expect(box.y + box.height).toBeLessThanOrEqual(SE.height);
    await expectClear(page, '[data-testid="tile-panel"]', '[data-testid="map-hud"]');
    // It ends between rows, fading at its foot while there's more below.
    await expectWholeRows(page);
    // The handles move up over it, under the land chip (shown here, as when land
    // misses you, with Wild Isle's cut-off card): Home and Bag stay one tap away
    // (#165), on nothing and under nothing. The cut-off card steps aside.
    await page.evaluate(() => {
      for (const id of ['land-chip', 'stranded-card']) {
        document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.hidden = false;
      }
    });
    await expect(page.getByTestId('land-chip')).toBeVisible();
    await expect(page.getByTestId('stranded-card')).toBeHidden();
    for (const side of ['adventure', 'heartpatch']) {
      await expect(page.getByTestId(`tray-handle-${side}`)).toBeVisible();
      await expectClear(
        page,
        `[data-testid="tray-handle-${side}"]`,
        '[data-testid="tile-panel"], [data-testid="map-hud"], .land-chip, .gather-chip',
      );
    }
    // A taller panel scrolls inside: its last button comes into view, inside the screen.
    const last = page.getByTestId('busy-last');
    await last.scrollIntoViewIfNeeded();
    const lastBox = (await last.boundingBox())!;
    const after = (await panel.boundingBox())!;
    expect(lastBox.y).toBeGreaterThanOrEqual(after.y);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(after.y + after.height);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(SE.height);
    await closePanel(page);
    await expect(page.locator('[data-testid^="tray-handle-"]').first()).toBeVisible();
    await expect(page.getByTestId('stranded-card')).toBeVisible();
    await page.evaluate(() => {
      for (const id of ['land-chip', 'stranded-card']) {
        document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.hidden = true;
      }
    });
  });

  await test.step('iPad: a busy tile panel stops under the map’s name pill', async () => {
    for (const size of [
      { width: 1080, height: 810 },
      { width: 820, height: 1180 },
    ]) {
      await page.setViewportSize(size);
      await openMyTile(page);
      await expectWholeRows(page);
      await makeBusy(page);
      await expectClear(page, '[data-testid="tile-panel"]', '[data-testid="map-hud"]');
      await expectWholeRows(page);
      await closePanel(page);
    }
  });

  await test.step('a phone on its side: the name pill moves up between the corner buttons', async () => {
    // An iPhone 15 on its side has its Dynamic Island's inset (59px) at the
    // left and right; Chromium can fake it (as battle-ui does), WebKit can't.
    const chromium = page.context().browser()?.browserType().name() === 'chromium';
    const cdp = chromium ? await page.context().newCDPSession(page) : null;
    for (const size of LANDSCAPE_PHONES) {
      const side = cdp && size.width === 852 ? 59 : 0;
      await cdp?.send(
        'Emulation.setSafeAreaInsetsOverride' as never,
        { insets: { top: 0, bottom: side ? 21 : 0, left: side, right: side } } as never,
      );
      await page.setViewportSize(size);
      // The pill sits in the top row (Layout B1: the panel can't stop under it
      // and still fit a busy tile's buttons, #264), clear of "My patches", the
      // round buttons and the Me button, and out of the notch.
      const hud = page.getByTestId('map-hud');
      await expect(hud).toHaveAttribute('data-place', 'top');
      await expectClear(
        page,
        '[data-testid="map-hud"]',
        '.tray-top-left, .tray-top-right > button, .auth-chip-toggle',
      );
      const pill = (await hud.boundingBox())!;
      expect(pill.x).toBeGreaterThanOrEqual(side);
      expect(pill.x + pill.width).toBeLessThanOrEqual(size.width - side);
      expect(pill.y + pill.height).toBeLessThanOrEqual(64);
      // The widest name shortens with … ("Moonberr…"); the 💛 count stays whole, in the pill.
      const name = hud.locator('.map-hud-name');
      expect(await name.evaluate((n) => n.scrollWidth > n.clientWidth)).toBe(true);
      await expect(name).toHaveCSS('text-overflow', 'ellipsis');
      const coins = (await hud.getByTestId('heart-coins').boundingBox())!;
      expect(coins.width).toBeGreaterThan(0);
      expect(coins.x + coins.width).toBeLessThanOrEqual(pill.x + pill.width);
      // A quiet tile and a busy one: neither reaches the pill, and both end
      // between rows.
      await openMyTile(page);
      await expectClear(page, '[data-testid="tile-panel"]', '[data-testid="map-hud"]');
      await expectWholeRows(page);
      await makeBusy(page);
      await expectClear(page, '[data-testid="tile-panel"]', '[data-testid="map-hud"]');
      await expectWholeRows(page);
      const box = (await page.getByTestId('tile-panel').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      // Still room for a few rows (#138: a phone on its side).
      expect(box.height).toBeGreaterThan(180);
      await closePanel(page);
      // The Build sheet hides the trays: the pill stays up, clear of the sheet.
      await openBuildable(page);
      await page.getByTestId('tile-build').tap();
      await expect(page.getByTestId('build-sheet')).toBeVisible();
      await expect(hud).toHaveAttribute('data-place', 'top');
      await expectClear(
        page,
        '[data-testid="map-hud"]',
        '.auth-chip-toggle, [data-testid="tile-panel"]',
      );
      await page.getByTestId('build-cancel').tap();
      await closePanel(page);
      // The trays come back: the pill moves back out from under the round buttons.
      await expect(page.locator('.tray-top-right > button').first()).toBeVisible();
      await expectClear(
        page,
        '[data-testid="map-hud"]',
        '.tray-top-left, .tray-top-right > button, .auth-chip-toggle',
      );
    }
    await cdp?.send(
      'Emulation.setSafeAreaInsetsOverride' as never,
      { insets: { top: 0, bottom: 0, left: 0, right: 0 } } as never,
    );
  });

  await test.step('upright phones and iPads: the name pill stays under the corner buttons', async () => {
    for (const size of [SE, { width: 393, height: 852 }, { width: 1080, height: 810 }]) {
      await page.setViewportSize(size);
      const hud = page.getByTestId('map-hud');
      await expect(hud).not.toHaveAttribute('data-place', 'top');
      expect((await hud.boundingBox())!.y).toBe(64);
    }
  });

  for (const screen of [
    SE,
    ...LANDSCAPE_PHONES,
    { width: 393, height: 852 },
    { width: 1080, height: 810 },
    { width: 820, height: 1180 },
  ]) {
    await test.step(`${String(screen.width)}×${String(screen.height)}: the Build sheet`, async () => {
      await page.setViewportSize(screen);
      await openBuildable(page);
      const me = page.locator('.auth-chip-toggle');
      await expect(me).toBeVisible();
      await page.getByTestId('tile-build').tap();
      await expect(page.getByTestId('build-sheet')).toBeVisible();
      await settled(page);
      // The round Me button stays in its corner, clear of the sheet, and opens
      // the menu with Log out; the wide "Hi, name! Log out" pill never shows.
      await expect(me).toBeVisible();
      await expectClear(page, '.auth-chip-toggle', '[data-testid="tile-panel"]');
      await expect(page.locator('.auth-chip-name')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Log out' })).toBeHidden();
      await me.tap();
      await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
      await me.tap();
      await expect(page.getByRole('button', { name: 'Log out' })).toBeHidden();
      // Build! and Not now are whole, unfaded, on screen at the panel's foot.
      await expectBuildRow(page, screen.height);
      await page.getByTestId('build-cancel').tap();
      await expect(page.getByTestId('build-sheet')).toBeHidden();
      await expect(me).toBeVisible();
      await closePanel(page);
    });
  }
  await page.context().close();
});
