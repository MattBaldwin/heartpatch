import { findAvoidedWords, type MapView } from '@heartpatch/shared';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { claimLand, findTile } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Fences on an iPhone (issue #203, #371): a new player claims land next to
 * home, then from its tile panel and the shared Build sheet builds a Hedge on
 * every open edge in four taps or fewer, upgrades one
 * segment, and takes it down for half back. The map draws each segment and
 * follows every change live. Checked through the dev hook's signals, never
 * pixels. (Breaking a fence in a challenge is the server's tests' job.)
 */

/** `FenceDebug` from src/fences/fence-screen.ts (this project can't see its types). */
interface FenceDebug {
  mapId: string;
  mode: 'card' | 'list' | 'fence' | 'confirm' | null;
  items: Record<string, number> | null;
}

const fenceState = (page: Page) => hook<FenceDebug>(page, 'fences');

/** `TileBuildDebug` from src/building/tile-build.ts. */
interface BuildDebug {
  mode: 'card' | 'build' | null;
  cards: string[];
  selected: string | null;
  edges: number[];
  bag: Record<string, number> | null;
}
const buildState = (page: Page) => hook<BuildDebug>(page, 'tileBuild');
const mapState = (page: Page) =>
  hook<{ id: string; live: string | null; selected: string | null; fences: number }>(page, 'map');

/** The claimed tile's fences, as the server's map view has them. */
async function fencesOn(page: Page, mapId: string, at: { q: number; r: number }) {
  const view = await api<MapView>(page, 'GET', `/maps/${mapId}/view`);
  const tile = view.body.tiles.find((t) => t.q === at.q && t.r === at.r);
  return tile?.fences ?? [];
}

test('builds a fence on every open edge, upgrades one, and takes one down', async ({ browser }) => {
  test.setTimeout(240_000); // map and arena builds and a claim; CI renders in software
  const page = await newPlayer(browser, uniqueName('fence'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Fence Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await mapState(page))?.live).toBe('live');
  const mapId = (await mapState(page))!.id;

  const land = await claimLand(page, mapId);
  // Plenty of greens and timber for a Hedge on every edge, and its upgrade.
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { greens: 80, timber: 20 },
  });
  expect(granted.status).toBe(201);

  // My land out past home: its panel says how it's fenced, and offers Build.
  // Every tap counts: a fence is four or fewer from the map (#371).
  let taps = 0;
  const tap = async (target: Locator) => {
    taps += 1;
    await target.tap();
  };
  await findTile(page, 'watch');
  taps += 1; // the tap on the tile
  expect((await mapState(page))!.selected).toBe(`${String(land.q)},${String(land.r)}`);
  const status = page.getByTestId('fence-status');
  await expect(status).toBeVisible();
  expect(findAvoidedWords((await status.textContent()) ?? '')).toEqual([]);

  // Build: every open edge starts lit, one row holds every building.
  await tap(page.getByTestId('tile-build'));
  await expect.poll(async () => (await buildState(page))?.mode).toBe('build');
  await expect.poll(async () => (await buildState(page))?.bag?.['greens']).toBe(80);
  const edges = (await buildState(page))!.edges.length;
  expect(edges).toBeGreaterThan(0);
  const row = page.getByTestId('build-row');
  await expect(row.locator('[data-build="hedge"]')).toBeVisible();
  // Nothing scrolls up and down inside the panel, and the row swipes sideways.
  const sheet = page.getByTestId('build-sheet');
  const box = (await sheet.boundingBox())!;
  const panel = (await page.getByTestId('tile-panel').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
  expect(
    await page.getByTestId('tile-panel').evaluate((e) => e.scrollHeight <= e.clientHeight + 1),
  ).toBe(true);
  expect(await row.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  // Hedge is the card to pick; the fire is first in the row on a free tile.
  await tap(row.locator('[data-build="hedge"]'));
  await expect.poll(async () => (await buildState(page))?.selected).toBe('hedge');
  // "None" and "All edges" for those who'd rather not tap the tile.
  await page.getByTestId('build-all-edges').tap();
  await expect.poll(async () => (await buildState(page))?.edges.length).toBe(0);
  await expect(page.getByTestId('build-go')).toBeDisabled();
  await page.getByTestId('build-all-edges').tap();
  await expect.poll(async () => (await buildState(page))?.edges.length).toBe(edges);
  const build = page.getByTestId('build-go');
  await expect(build).toBeEnabled();
  await tap(build);
  await expect.poll(async () => (await buildState(page))?.mode).toBe('card');
  expect(taps).toBeLessThanOrEqual(4);
  await expect(page.getByTestId('tile-build-note')).toContainText('up!');
  expect((await fencesOn(page, mapId, land)).length).toBe(edges);
  // The map draws every segment, live.
  await expect.poll(async () => (await mapState(page))?.fences).toBe(edges);
  await expect(page.getByTestId('fence-status')).toContainText('Fenced all the way round');

  // Fences stay one tap from the tile: the segments, each with Repair, Upgrade
  // and Take down, with nothing scrolling inside the panel.
  await page.getByTestId('fence-open').tap();
  await expect.poll(async () => (await fenceState(page))?.mode).toBe('list');
  await expect(page.getByTestId('fence-segment')).toHaveCount(edges);
  // A segment's card: full energy, an upgrade with before and after.
  await page.getByTestId('fence-segment').first().tap();
  await expect.poll(async () => (await fenceState(page))?.mode).toBe('fence');
  await expect(page.getByTestId('fence-percent')).toContainText('100%');
  await expect(page.getByTestId('fence-upgrade-preview')).toContainText('70/70 → 100/100');
  // Its cost can make a long label: the button still stays inside the card.
  const card = (await page.getByTestId('tile-panel').boundingBox())!;
  const upgrade = (await page.getByTestId('fence-upgrade').boundingBox())!;
  expect(upgrade.x + upgrade.width).toBeLessThanOrEqual(card.x + card.width);
  await page.getByTestId('fence-upgrade').tap();
  await expect(page.getByTestId('fence-note')).toContainText('Level 2');
  await expect
    .poll(async () => (await fencesOn(page, mapId, land)).filter((f) => f.level === 2).length)
    .toBe(1);

  // Take it down: it asks first and says what comes back.
  await page.getByTestId('fence-take-down').tap();
  await expect.poll(async () => (await fenceState(page))?.mode).toBe('confirm');
  await page.getByTestId('fence-yes-take-down').tap();
  await expect.poll(async () => (await fenceState(page))?.mode).toBe('list');
  await expect(page.getByTestId('fence-note')).toContainText('You got back');
  await expect(page.getByTestId('fence-segment')).toHaveCount(edges - 1);
  await expect.poll(async () => (await mapState(page))?.fences).toBe(edges - 1);
  expect(findAvoidedWords((await page.getByTestId('tile-panel').textContent()) ?? '')).toEqual([]);

  expect(errors).toEqual([]);
});
