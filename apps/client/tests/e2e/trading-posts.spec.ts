import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Trading posts on an iPhone (issue #269, mockup screen a): a new patch has
 * its 4 posts, a flag shows over each one in view saying how far it is, and
 * tapping one opens its tile panel: its name, that it's everyone's, how far it
 * is from my land and that trading opens soon, with nothing to claim. Checked
 * through the dev hook's signals, never pixels.
 */

/** `PostFlags` debug from src/trading/post-flags.ts (this project can't see its types). */
interface PostsDebug {
  shown: number;
  rings: number;
  onScreen: { name: string; x: number; y: number }[];
}

const posts = (page: Page) => hook<PostsDebug>(page, 'posts');
const mapState = (page: Page) =>
  hook<{ live: string | null; selected: string | null }>(page, 'map');
const territoryState = (page: Page) => hook<{ tileAction: string | null }>(page, 'territory');

test('shows the trading posts near home, and a post’s panel says what it is', async ({
  browser,
}) => {
  test.setTimeout(180_000); // the map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('posts'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Post Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await mapState(page))?.live).toBe('live');

  // A post sits 3 steps from my Heart Seed, so one is in view from home.
  await expect.poll(async () => (await posts(page))?.shown ?? 0).toBeGreaterThan(0);
  // Day 1: none touches my land yet, so no gold ring.
  expect((await posts(page))!.rings).toBe(0);
  const flag = page.getByTestId('post-flag').filter({ visible: true }).first();
  await expect(flag).toHaveText(/^🏮 .+ · \d+ tiles?$/);

  // Tap the post: its panel names it and says how far it is; nothing to claim.
  const [post] = (await posts(page))!.onScreen;
  await tapCanvas(page, post!.x, post!.y);
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#tile-panel-title')).toHaveText(post!.name);
  await expect(panel).toContainText('A trading post for every Keeper. Nobody can claim it!');
  await expect(page.getByTestId('tile-panel-post')).toHaveText(/tiles? from your land/);
  await expect(page.getByTestId('tile-panel-post-soon')).toBeVisible();
  await expect(page.getByTestId('tile-panel-guardians')).toBeHidden();
  expect((await territoryState(page))?.tileAction ?? 'none').toBe('none');
  await expect(panel.getByRole('button', { name: /Claim|Challenge/ })).toHaveCount(0);
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);

  expect(errors).toEqual([]);
  await page.context().close();
});
