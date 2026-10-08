import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { traysState } from './trays.js';
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
/** `JourneyDebug` from src/trading/journey-screen.ts. */
const journeyState = (page: Page) =>
  hook<{
    preview: { q: number; r: number; level: number; teamSize: number } | null;
    passes: string[];
  }>(page, 'journey');
const battleState = (page: Page) =>
  hook<{
    status: 'active' | 'finished' | 'no-contest';
    phase: 'turn' | 'replace' | 'over';
    pending: number;
    waiting: boolean;
    winner: 'a' | 'b' | 'draw' | null;
    scene: { arena: { terrain: string; known: boolean } } | null;
  }>(page, 'battle');

/** A new patch on screen, live, for a new player. */
async function newPatch(page: Page): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Post Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await mapState(page))?.live).toBe('live');
}

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
  // A post a journey away shows its journey (#270) rather than "soon".
  await expect(page.getByTestId('tile-panel-post-soon')).toBeHidden();
  await expect(page.getByTestId('journey-preview')).toBeVisible();
  await expect(page.getByTestId('tile-panel-guardians')).toBeHidden();
  expect((await territoryState(page))?.tileAction ?? 'none').toBe('none');
  await expect(panel.getByRole('button', { name: /Claim|Challenge/ })).toHaveCount(0);
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);

  expect(errors).toEqual([]);
  await page.context().close();
});

test('sets off on a journey to a post, wins, and the post opens for a visit (#270)', async ({
  browser,
}) => {
  test.setTimeout(240_000); // the map build and a battle; CI renders in software
  const page = await newPlayer(browser, uniqueName('journey'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await newPatch(page);
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;
  // A strong grown-up friend (no evolving party after the battle), so the
  // journey is a sure win and the team is strong.
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'hearthbun',
    level: 40,
  });
  expect(granted.status).toBe(201);
  // An open side tray covers part of the map and the tile panel: shut it first.
  const open = (await traysState(page))?.open ?? null;
  if (open !== null) {
    await page.getByTestId(`tray-handle-${open}`).tap();
    await expect.poll(async () => (await traysState(page))?.open, { timeout: 15_000 }).toBeNull();
  }

  // Tap a post: the panel shows the journey (mockup screen b).
  await expect.poll(async () => (await posts(page))?.shown ?? 0).toBeGreaterThan(0);
  const [post] = (await posts(page))!.onScreen;
  await tapCanvas(page, post!.x, post!.y);
  const panel = page.getByTestId('tile-panel');
  await expect(panel.locator('#tile-panel-title')).toHaveText(post!.name);
  const preview = page.getByTestId('journey-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('aria-label', `Journey to ${post!.name}`);
  await expect(page.getByTestId('journey-trail')).toHaveText(
    /^Trail squishies: \d, about level \d+$/,
  );
  await expect(page.getByTestId('journey-chance')).toHaveText('Good chance! 👍');
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);
  const trip = (await journeyState(page))!.preview!;
  // "Start journey" is on screen without scrolling the panel (style guide §3).
  await expect(page.getByTestId('journey-start')).toBeInViewport({ ratio: 1 });

  // Set off: a journey battle on the post's own ground (screen c).
  await page.getByTestId('journey-start').tap();
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await battleState(page))?.scene?.arena ?? null, { timeout: 30_000 })
    .toMatchObject({ terrain: 'trading-post', known: true });
  // Trail squishies can't be befriended: no Heart Charm button.
  await expect(page.getByTestId('battle-capture')).toHaveCount(0);
  for (let i = 0; i < 60; i++) {
    await expect
      .poll(() => battleState(page), { timeout: 30_000 })
      .toMatchObject({ pending: 0, waiting: false });
    const current = (await battleState(page))!;
    if (current.status !== 'active') break;
    const button = page.getByTestId(current.phase === 'replace' ? 'battle-replace' : 'battle-move');
    await button.first().tap();
  }
  expect(await battleState(page)).toMatchObject({ status: 'finished', winner: 'a' });
  const result = page.getByTestId('battle-result');
  await expect(result).toContainText(`You made it to ${post!.name}!`);
  await expect(result).toContainText('The post is open for you for 20 minutes.');

  // "Open the post": back on the map with the post's panel and its pass.
  await page.getByTestId('battle-done').tap();
  await expect(hud).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(panel.locator('#tile-panel-title')).toHaveText(post!.name, { timeout: 30_000 });
  await expect(page.getByTestId('journey-open')).toHaveText(
    '⏳ The post is open for you for 20 more minutes!',
  );
  await expect(page.getByTestId('journey-soon')).toBeVisible();
  await expect(page.getByTestId('journey-preview')).toHaveCount(0);
  expect((await journeyState(page))!.passes).toEqual([`${String(trip.q)},${String(trip.r)}`]);

  expect(errors).toEqual([]);
  await page.context().close();
});
