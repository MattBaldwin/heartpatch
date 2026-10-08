import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTapAt } from './touch.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

/**
 * Exploring your land (#199): Explore on a home tile opens it up close, the
 * Keeper walks to a sparkle when the ground is tapped, the easy way searches
 * it and the find card shows, a Shovel mound without a Shovel says how to
 * make one, and Back returns to the map. Checked through the dev hook.
 */

interface ExploreDebug {
  open: boolean;
  tile: { q: number; r: number; terrain: string } | null;
  progress: { searched: number; total: number } | null;
  spots: { index: number; kind: string; tool: string | null; done: boolean }[];
  keeper: { x: number; z: number };
  near: number | null;
  playing: string | null;
  card: 'find' | 'missing' | null;
  scene: { spots: number; done: number; keeper: boolean; highlighted: number | null } | null;
}

const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const mapState = (page: Page) => hook<{ tiles: number }>(page, 'map');

/** Where a spot is on screen now (the dev hook projects it). */
async function spotOnScreen(page: Page, index: number): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((i) => {
    type Hook = {
      explore?: () => { spotOnScreen: (i: number) => { x: number; y: number } | null };
    };
    return (window as unknown as { __heartpatch?: Hook }).__heartpatch?.explore?.().spotOnScreen(i);
  }, index);
  if (!at) throw new Error(`spot ${String(index)} is not on screen`);
  return at;
}

/** Taps the ground by a spot and waits for the Keeper to walk up to it. */
async function walkTo(page: Page, index: number): Promise<void> {
  const at = await spotOnScreen(page, index);
  await realTapAt(page, at.x, at.y);
  await expect.poll(async () => (await exploreState(page))?.near, slow).toBe(index);
}

test('explores a home tile: walk, search the easy way, a find card, a missing Shovel', async ({
  browser,
}) => {
  test.setTimeout(150_000); // two scene builds; CI renders in software
  const page = await newPlayer(browser, uniqueName('explore'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Seeker Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(469);

  // The camera starts on the Heart Seed: tap it, then Explore.
  const box = (await page.locator('#game').boundingBox())!;
  await realTapAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const explore = page.getByTestId('tile-explore');
  await slowExpect(explore).toBeVisible();
  await explore.tap();

  await expect.poll(async () => (await exploreState(page))?.scene?.keeper, slow).toBe(true);
  const first = (await exploreState(page))!;
  expect(first.open).toBe(true);
  expect(first.spots.length).toBeGreaterThan(0);
  await slowExpect(page.getByTestId('map-hud')).toBeHidden();
  await expect(page.getByTestId('explore-progress')).toHaveText(
    `0 of ${String(first.spots.length)} found 🔍`,
  );
  // Nothing in reach: the big button says to walk up to a sparkle.
  if (first.near === null) await expect(page.getByTestId('explore-action')).toBeDisabled();
  else await expect(page.getByTestId('explore-action')).toBeEnabled();

  // Walk to a spot searched by hand, then search it the easy way.
  const hands = first.spots.find((s) => s.tool === null)!;
  await walkTo(page, hands.index);
  const action = page.getByTestId('explore-action');
  await slowExpect(action).toBeEnabled();
  await action.tap();
  await slowExpect(page.getByTestId('explore-stage')).toBeVisible();
  await page.getByTestId('explore-easy').tap();
  await expect.poll(async () => (await exploreState(page))?.card, slow).toBe('find');
  const sheet = page.getByTestId('explore-sheet');
  await slowExpect(sheet).toContainText('Ta-da!');
  for (const text of await page.getByTestId('explore-finds').locator('li').allTextContents()) {
    expect(findAvoidedWords(text)).toEqual([]);
  }
  await sheet.getByTestId('explore-keep-going').tap();
  await slowExpect(sheet).toBeHidden();
  const after = (await exploreState(page))!;
  expect(after.progress?.searched).toBe(1);
  expect(after.spots.find((s) => s.index === hands.index)?.done).toBe(true);
  expect(after.scene?.done).toBe(1);
  await expect(page.getByTestId('explore-progress')).toHaveText(
    `1 of ${String(first.spots.length)} found 🔍`,
  );

  // A mound needs a Shovel: the card says how to make one, and nothing is spent.
  const mound = first.spots.find((s) => s.tool === 'shovel');
  if (mound) {
    await walkTo(page, mound.index);
    await action.tap();
    await expect.poll(async () => (await exploreState(page))?.card, slow).toBe('missing');
    await slowExpect(sheet).toContainText('You need a Shovel to dig there!');
    await slowExpect(page.getByTestId('explore-recipe')).toContainText('Timber');
    await sheet.getByTestId('explore-something-else').tap();
    await slowExpect(sheet).toBeHidden();
    expect((await exploreState(page))?.progress?.searched).toBe(1);
  }

  // Back to the map, with the explore view put away.
  await page.getByTestId('explore-back').tap();
  await slowExpect(page.getByTestId('map-hud')).toBeVisible();
  expect((await exploreState(page))?.open).toBe(false);
  expect(errors).toEqual([]);
});
