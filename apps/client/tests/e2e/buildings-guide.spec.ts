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
