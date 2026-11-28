import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
import { tapCanvas } from './claim-land.js';
import { stubBossFight, type BossStubOptions } from './boss-stub.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap } from './touch.js';
import { trayButton } from './trays.js';

/**
 * The Christmas Eve patch bar on screen (#37 X4): a thin full-width line under
 * the boss strip in the fight (gold when full, moved by live `boss.chipped` /
 * `boss.fell`), and ❄ with the percentage on the map's tile card. The fight is
 * stood in for by boss-stub.ts and the Eve's map view is answered here (the
 * server's dev route needs Dec 24 on the clock); the client is the real one.
 */

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/** The visit's window id the stand-in fight carries; the live events name it. */
const EVE = '2026-12-24';
const PATCH_ID = EVE;

async function rect(page: Page, testId: string): Promise<Rect> {
  return page.getByTestId(testId).evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height,
    };
  });
}

async function openFight(page: Page, options: BossStubOptions): Promise<void> {
  // The held clock gives the dev controls (`emit`).
  await page.goto('/?battle-clock=manual');
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Eve Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  for (let i = 0; i < 2; i++) {
    await realTap(await trayButton(page, 'battle-dev-grant'));
    await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  }
  await stubBossFight(page, options);
  await realTap(await trayButton(page, 'battle-dev-fight'));
  await expect(page.getByTestId('boss-strip')).toBeVisible({ timeout: 30_000 });
}

/** Moves the held battle clock on. */
async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((step) => {
    const hook = (window as { __heartpatch?: { battleDev?: () => unknown } }).__heartpatch;
    const dev = hook?.battleDev?.() as { advance: (ms: number) => void } | null | undefined;
    dev?.advance(step);
  }, ms);
}

/** A live event, as the socket would deliver it for the fight's map. */
async function emit(page: Page, type: string, data: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ type, data }) => {
      const hook = (
        window as { __heartpatch?: { battleDev?: () => unknown; battle?: () => unknown } }
      ).__heartpatch;
      const dev = hook?.battleDev?.() as { emit: (e: unknown) => void } | null | undefined;
      if (!dev) throw new Error('no dev controls: open the page with ?battle-clock=manual');
      dev.emit({ type, mapId: '', seq: 1, at: new Date().toISOString(), data });
    },
    { type, data },
  );
}

test.describe('the patch bar in a fight (#37 X4)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a thin full-width line under the strip, moved live, gold when it falls', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('eve'));
    await openFight(page, { eventWindow: EVE, patchBar: { goal: 200, chipped: 80 } });

    const bar = page.getByTestId('patch-bar');
    await expect(bar).toBeVisible();
    // 80 of 200 is 40 %, and a screen reader hears it.
    await expect(bar).toHaveAttribute('aria-label', 'Patch bar, 40 percent');
    await expect(bar).toHaveAttribute('data-percent', '40');
    await expect(bar).not.toHaveClass(/patch-bar-full/);

    // A thin line: about 4 px, as wide as the screen, under the strip and the stage band below it.
    const line = await rect(page, 'patch-bar');
    const strip = await rect(page, 'boss-strip');
    const viewport = page.viewportSize()!;
    expect(line.height).toBeGreaterThanOrEqual(3);
    expect(line.height).toBeLessThanOrEqual(5);
    expect(line.width).toBeGreaterThan(viewport.width * 0.9);
    expect(line.top).toBeGreaterThanOrEqual(strip.bottom);
    const energy = await rect(page, 'boss-energy');
    expect(energy.bottom).toBeLessThanOrEqual(strip.bottom);
    const state = await hook<{ scene: { framing: { band: { top: number } } | null } | null }>(
      page,
      'battle',
    );
    const bandTop = (state?.scene?.framing?.band.top ?? 0) * viewport.height;
    expect(bandTop).toBeGreaterThanOrEqual(line.bottom);

    // A fight on the patch moves it, for everyone: 120 of 200 is 60 %.
    const window = EVE;
    await emit(page, 'boss.chipped', { window: '2000-01-01', chipped: 190, goal: 200 });
    await expect(bar).toHaveAttribute('data-percent', '40'); // another visit's bar: ignored
    await emit(page, 'boss.chipped', { window, chipped: 120, goal: 200 });
    await expect(bar).toHaveAttribute('data-percent', '60');
    await expect(bar).toHaveAttribute('aria-label', 'Patch bar, 60 percent');
    // A late, older read never moves it back.
    await emit(page, 'boss.chipped', { window, chipped: 100, goal: 200 });
    await expect(bar).toHaveAttribute('data-percent', '60');
    // 97 % still isn't full: no gold until it falls.
    await emit(page, 'boss.chipped', { window, chipped: 194, goal: 200 });
    await expect(bar).toHaveAttribute('data-percent', '95');
    await expect(bar).not.toHaveClass(/patch-bar-full/);
    // It falls: gold, and the label says full.
    await emit(page, 'boss.fell', {
      window,
      fellAt: new Date().toISOString(),
      chipped: 205,
      goal: 200,
    });
    await expect(bar).toHaveClass(/patch-bar-full/);
    await expect(bar).toHaveAttribute('data-percent', '100');
    await expect(bar).toHaveAttribute('aria-label', 'Patch bar, full');
  });

  test('after the fight a "Chipped!" sticker shows ❄ and the percentage, and my points', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('chipped'));
    await openFight(page, { eventWindow: EVE, patchBar: { goal: 200, chipped: 80 } });
    // The held clock freezes the BIG squishy's entrance: run it out.
    await expect
      .poll(async () => (await hook<{ entrance: unknown }>(page, 'battle'))?.entrance != null)
      .toBe(true);
    await page.evaluate(() => {
      const dev = (
        window as { __heartpatch?: { battleDev?: () => unknown } }
      ).__heartpatch?.battleDev?.() as { advance: (ms: number) => void } | null | undefined;
      dev?.advance(3000);
    });
    await expect
      .poll(async () => (await hook<{ entrance: unknown }>(page, 'battle'))?.entrance ?? null)
      .toBeNull();
    const picker = page.getByTestId('boss-picker');
    await expect(picker).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await expect(page.getByTestId('boss-pick-header')).toBeVisible();
      await realTap(picker.getByTestId('boss-move').first());
    }
    await realTap(page.getByTestId('boss-go'));
    // The server says my fight added 38 (the stand-in's chip lands live, to me alone).
    const sticker = page.getByTestId('patch-chipped');
    // The round plays on the held clock: step it on until the card is up.
    await expect(async () => {
      await advance(page, 2000);
      await expect(sticker).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    await expect(sticker).toContainText('Chipped!');
    await expect(sticker).toContainText('❄ 40%');
    await emit(page, 'boss.chipped', { window: EVE, points: 38, chipped: 156, goal: 200 });
    await expect(sticker).toContainText('You chipped in 38!');
    await expect(sticker).toContainText('❄ 80%');
    const sizes = await sticker.evaluate((node) =>
      [...node.querySelectorAll('p')].map((p) => Number.parseFloat(getComputedStyle(p).fontSize)),
    );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
  });

  test('a weekly boss has no line', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('weekly'));
    await openFight(page, {});
    await expect(page.getByTestId('patch-bar')).toBeHidden();
  });
});

test('the Eve card on the map shows ❄ and the percentage', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await newPlayer(browser, uniqueName('card'));
  await page.route('**/api/v1/maps/*/view', async (route) => {
    const res = await route.fetch();
    const view = (await res.json()) as Record<string, unknown>;
    view['christmas'] = {
      presentWaiting: false,
      eve: {
        opensAt: '2026-12-24T16:00:00.000Z',
        state: 'open',
        chipped: 130,
        goal: 200,
      },
    };
    await route.fulfill({ response: res, json: view });
  });
  await page.route('**/api/v1/maps/*/boss', async (route) => {
    const mapId = /\/maps\/([^/]+)\/boss/.exec(route.request().url())?.[1] ?? '';
    const tiles = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/maps/${id}/view`);
      return (
        (await res.json()) as {
          tiles: { q: number; r: number; terrain: string; ownerUserId: string | null }[];
        }
      ).tiles;
    }, mapId);
    const tile = tiles.find((t) => t.ownerUserId === null && t.terrain === 'meadow') ?? tiles[0]!;
    await route.fulfill({
      json: {
        boss: {
          window: { id: PATCH_ID, endsAt: new Date(Date.now() + 86_400_000).toISOString() },
          tile: { q: tile.q, r: tile.r },
          species: null,
          state: 'here',
          triesLeftToday: 3,
        },
      },
    });
  });
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Eve Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();

  const panel = page.getByTestId('tile-panel');
  await expect(async () => {
    const marker = (await hook<{ x: number; y: number }>(page, 'boss'))!;
    await tapCanvas(page, marker.x, marker.y);
    await expect(panel.getByTestId('patch-card')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  // 130 of 200 is 65 %.
  await expect(panel.getByTestId('patch-card-percent')).toHaveText('❄ 65%');
  await expect(panel.getByRole('progressbar', { name: 'Patch bar, 65 percent' })).toBeVisible();
  const sizes = await panel
    .getByTestId('patch-card')
    .evaluate((node) =>
      [...node.querySelectorAll('p')].map((p) => Number.parseFloat(getComputedStyle(p).fontSize)),
    );
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
});
