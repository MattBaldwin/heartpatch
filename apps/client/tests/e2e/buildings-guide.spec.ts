import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { claimLand, findTile } from './claim-land.js';
import { api, hook, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The Buildings guide on an iPhone (#715): from my land's Build sheet, "See
 * all buildings" lists every building on the patch, says which fit this
 * tile (the same cards the Build sheet offers) and how many of my tiles
 * take each, and "Build here" goes back to the sheet with that card picked.
 * Checked through the dev hook's signals, never pixels.
 */

/** `BuildingsGuideDebug` from src/building/buildings-guide.ts. */
interface GuideDebug {
  open: boolean;
  filter: 'fits' | 'all';
  ids: string[];
  fits: string[];
  later: string[];
  counts: Record<string, number>;
}
/** `TileBuildDebug` from src/building/tile-build.ts. */
interface BuildDebug {
  mode: 'card' | 'build' | null;
  cards: string[];
  selected: string | null;
}
const guideState = (page: Page) => hook<GuideDebug>(page, 'buildingsGuide');
const buildState = (page: Page) => hook<BuildDebug>(page, 'tileBuild');
const mapState = (page: Page) => hook<{ id: string; selected: string | null }>(page, 'map');

/** The cards whose picture the guide's list shows on screen now, by building id. */
const onScreen = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('[data-testid="guide-list"]');
    if (!list) return [];
    const box = list.getBoundingClientRect();
    return [...list.querySelectorAll<HTMLElement>('[data-testid="guide-entry"]')]
      .filter((card) => {
        const r = card.querySelector('.guide-portrait')?.getBoundingClientRect();
        if (!r) return false;
        return r.bottom > box.top && r.top < box.bottom;
      })
      .map((card) => card.dataset['building'] ?? '');
  });

/**
 * Every card on screen gets its picture (the guide's own `data-portrait`
 * signal), and a real model's: `plain` is the lilac box of a building with none.
 */
async function picturesDrawn(page: Page): Promise<string[]> {
  const ids = await onScreen(page);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    const picture = page.locator(`[data-building="${id}"] .guide-portrait`);
    await expect(picture, `${id}'s picture`).toHaveAttribute(
      'data-portrait',
      /^(drawn|plain|none)$/,
      { timeout: 60_000 },
    );
    expect(await picture.getAttribute('data-portrait'), `${id}'s picture is its own model`).toBe(
      'drawn',
    );
  }
  return ids;
}

/** The picked jump chip sits wholly inside the chip row's visible box. */
async function pickedChipShown(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="guide-jump"]');
    const chip = row?.querySelector('.guide-chip[aria-current="true"]');
    if (!row || !chip) return false;
    const r = row.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    return c.left >= r.left && c.right <= r.right;
  });
}

/** The ✕ is what a tap at its middle lands on: nothing (the Keeper menu) covers it. */
async function closeTappable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const close = document.querySelector('[data-testid="guide-close"]');
    if (!close) return false;
    const r = close.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && close.contains(hit);
  });
}

test('See all buildings lists every building, what fits here, and builds from it', async ({
  browser,
}) => {
  test.setTimeout(240_000); // a map build and a claim; CI renders in software
  const page = await newPlayer(browser, uniqueName('guide'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Guide Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForLiveMap(page);
  const mapId = (await mapState(page))!.id;

  const land = await claimLand(page, mapId);
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { greens: 80, timber: 20 },
  });
  expect(granted.status).toBe(201);

  await findTile(page, 'watch');
  expect((await mapState(page))!.selected).toBe(`${String(land.q)},${String(land.r)}`);
  await page.getByTestId('tile-build').tap();
  await expect.poll(async () => (await buildState(page))?.mode).toBe('build');
  const offered = (await buildState(page))!.cards;

  // The link sits in the Build sheet; the guide opens over it.
  await page.getByTestId('build-see-all').tap();
  const guide = page.getByTestId('buildings-guide');
  await expect(guide).toBeVisible();
  await expect.poll(async () => (await guideState(page))?.open).toBe(true);
  const state = (await guideState(page))!;
  // Every building of the patch, the fire and the fences among them.
  expect(state.ids).toEqual(expect.arrayContaining(['hearthfire', 'hedge', 'training-grounds']));
  // What fits is exactly what the Build sheet offers here, unblocked.
  expect(state.fits.length).toBeGreaterThan(0);
  for (const id of state.fits) expect(offered).toContain(id);
  expect(state.fits).toContain('hedge');
  // My claimed tile takes a hedge, so at least one tile counts it.
  expect(state.counts['hedge'] ?? 0).toBeGreaterThanOrEqual(1);
  await expect(guide.getByTestId('guide-entry')).toHaveCount(state.ids.length);

  // Each card on screen gets its picture, the fire's first among them.
  expect(await picturesDrawn(page)).toContain('hearthfire');
  expect(await closeTappable(page)).toBe(true);

  const hedge = guide.locator('[data-building="hedge"]');
  await expect(hedge.getByTestId('guide-fit')).toHaveText('✓ Fits this tile');
  // Every word on the sheet passes the kid-safe word list.
  expect(findAvoidedWords((await guide.textContent()) ?? '')).toEqual([]);

  // Fits this tile: only those.
  await guide.getByTestId('guide-filter-fits').tap();
  await expect(guide.getByTestId('guide-entry')).toHaveCount(state.fits.length);

  // The sheet stays inside the screen, clear of the bands.
  const box = (await guide.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);

  // The last cards (the end of the old all-at-once queue) draw as they
  // scroll in, and so does Coming later when this patch has one.
  await guide.getByTestId('guide-filter-all').tap();
  // The first shelf's chip starts picked; a tapped chip takes over, and the
  // fences draw as fences, not the plain box.
  const chips = guide.locator('.guide-chip');
  await expect(chips.first()).toHaveAttribute('aria-current', 'true');
  const fences = guide.locator('[data-jump="fences"]');
  await fences.tap();
  await expect(fences).toHaveAttribute('aria-current', 'true');
  await expect(guide.locator('.guide-chip[aria-current]')).toHaveCount(1);
  expect(await picturesDrawn(page)).toEqual(expect.arrayContaining(['hedge']));
  // Scrolling the list moves the pick, and the row slides the picked chip
  // fully into view (no "ires" for Fires), from the bottom back to the top.
  const shelfList = guide.getByTestId('guide-list');
  await shelfList.evaluate((l) => (l.scrollTop = l.scrollHeight));
  await expect.poll(() => pickedChipShown(page)).toBe(true);
  await shelfList.evaluate((l) => (l.scrollTop = 0));
  await expect(chips.first()).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => pickedChipShown(page)).toBe(true);
  await guide.getByTestId('guide-entry').last().scrollIntoViewIfNeeded();
  expect(await picturesDrawn(page)).toContain(state.ids.at(-1));
  if (state.later.length > 0) {
    await guide.locator('[data-jump="later"]').tap();
    expect(await picturesDrawn(page)).toContain(state.later[0]);
  }

  // Turned on its side (a phone only): the ✕ stays clear of the Keeper menu
  // and the list keeps real room under the header.
  if (view.width < 600) {
    await page.setViewportSize({ width: view.height, height: view.width });
    await expect.poll(() => closeTappable(page)).toBe(true);
    const list = (await guide.getByTestId('guide-list').boundingBox())!;
    expect(list.height).toBeGreaterThan(150);
    await page.setViewportSize(view);
  }

  // ‹ Build: back to the sheet, tile still picked.
  await guide.getByTestId('guide-back').tap();
  await expect(guide).toBeHidden();
  expect((await buildState(page))!.mode).toBe('build');

  // Build here: back to the sheet with the hedge picked.
  await page.getByTestId('build-see-all').tap();
  await expect(guide).toBeVisible();
  await hedge.getByTestId('guide-build').tap();
  await expect(guide).toBeHidden();
  await expect.poll(async () => (await buildState(page))?.selected).toBe('hedge');

  // ✕ closes the Build sheet too.
  await page.getByTestId('build-see-all').tap();
  await guide.getByTestId('guide-close').tap();
  await expect(guide).toBeHidden();
  await expect.poll(async () => (await buildState(page))?.mode).toBe('card');

  expect(errors).toEqual([]);
});
