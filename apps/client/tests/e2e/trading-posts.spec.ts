import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import {
  grantItems,
  grantSquishy,
  namesClipped,
  postState,
  shutTrays,
  tilesSpill,
  twoTraders,
  visitPost,
  wordsSplit,
} from './trading.js';

/**
 * Trading posts on an iPhone (issue #269, mockup screen a): a new patch has
 * its posts (one per seat), a flag shows over each one in view saying how far it is, and
 * tapping one opens its tile panel: its name, that it's everyone's, how far it
 * is from my land, with nothing to claim. A post my land reaches has "Visit
 * post", which opens its Trade, Gift and Mailbox tabs (#271). Checked through
 * the dev hook's signals, never pixels.
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
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
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
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');

  // A post sits 3 steps from my Heart Seed, so one is in view from home.
  await shutTrays(page);
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
  // A post a journey away shows its journey (#270), not "Visit post" (#271).
  await expect(page.getByTestId('post-visit')).toHaveCount(0);
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
  // An open side tray or Sprout's hint covers part of the map: shut them first.
  await shutTrays(page);

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
  await expect(page.getByTestId('post-visit')).toBeVisible();
  await expect(page.getByTestId('journey-preview')).toHaveCount(0);
  expect((await journeyState(page))!.passes).toEqual([`${String(trip.q)},${String(trip.r)}`]);

  expect(errors).toEqual([]);
  await page.context().close();
});

test('trades and gifts at a post: offer, say yes, and pick up from the mailbox (#271)', async ({
  browser,
}) => {
  test.setTimeout(300_000); // two players, two map builds; CI renders in software
  const { lee, sam, leeName, samName, mapId, errors } = await twoTraders(browser, 'Swap Patch');
  // Lee has a friend to trade (the patch starter stays) and some Timber; Sam has Stone.
  await grantSquishy(lee, mapId, 'emberbun', 9);
  await grantItems(lee, mapId, { timber: 3 });
  await grantSquishy(sam, mapId, 'pebblesnooze', 7);
  await grantItems(sam, mapId, { stone: 2 });

  // Lee: Trade tab (mockup screen e). Sam is picked; Lee gives Emberbun for Stone.
  await visitPost(lee);
  const leePost = lee.getByTestId('post');
  await expect.poll(async () => (await postState(lee))?.mate).not.toBeNull();
  // Long names stay whole: no word wraps inside itself (owner, #271), e.g. Sam's Pebblesnooze.
  await expect(leePost.getByTestId('post-want')).toContainText('Pebblesnooze');
  expect(await wordsSplit(lee)).toEqual([]);
  expect(await namesClipped(lee)).toEqual([]);
  // Turned on its side, the names fit the new width too.
  const size = lee.viewportSize()!;
  await lee.setViewportSize({ width: size.height, height: size.width });
  await expect.poll(() => namesClipped(lee)).toEqual([]);
  expect(await wordsSplit(lee)).toEqual([]);
  await lee.setViewportSize(size);
  await expect.poll(() => namesClipped(lee)).toEqual([]);
  await leePost
    .getByTestId('post-give')
    .getByRole('button', { name: /Emberbun/ })
    .tap();
  await leePost.getByTestId('post-want').getByRole('button', { name: /Stone/ }).tap();
  // Picked with a − / + stepper, the tile still sits inside its shelf.
  expect(await tilesSpill(lee)).toEqual([]);
  await leePost.getByTestId('post-note-want-to-trade').tap();
  await expect(leePost.getByTestId('post-send-hint')).toHaveText(
    `Your things wait safely at the post until ${samName} answers.`,
  );
  await leePost.getByTestId('post-send').tap();
  await expect(leePost.getByTestId('post-note')).toHaveText(
    `Sent! ${samName} will see it at a trading post. 💌`,
  );
  await expect.poll(async () => (await postState(lee))?.offersFromMe).toBe(1);
  await expect(leePost.getByTestId('post-offer-out')).toContainText(`Waiting for ${samName}`);
  expect(findAvoidedWords((await leePost.textContent()) ?? '')).toEqual([]);

  // Sam: the offer waits on the Trade tab with a badge; "Say yes!".
  await visitPost(sam);
  const samPost = sam.getByTestId('post');
  await expect(samPost.getByTestId('post-badge-trade')).toHaveText('1');
  const offer = samPost.getByTestId('post-offer-in');
  await expect(offer).toContainText(`${leeName} wants to trade!`);
  await expect(offer).toContainText('“Want to trade?”');
  await expect(offer).toContainText('Emberbun');
  await offer.getByTestId('post-accept').tap();
  await expect(samPost.getByTestId('post-note')).toHaveText(
    'Yay, you traded! 🎉 Your new things wait in your mailbox.',
  );
  await expect.poll(async () => (await postState(sam))?.offersToMe).toBe(0);

  // Lee hears it live: Sam's Stone waits in Lee's mailbox (screen d). Pick it up.
  await expect(leePost.getByTestId('post-badge-mailbox')).toHaveText('1', { timeout: 15_000 });
  await leePost.getByTestId('post-tab-mailbox').tap();
  const mail = leePost.getByTestId('post-mail');
  await expect(mail).toContainText(`Your trade with ${samName} is done!`);
  await expect(mail).toContainText('Stone ×1');
  await mail.getByTestId('post-pickup').tap();
  await expect(leePost.getByTestId('post-note')).toHaveText('All picked up! 🎉');
  await expect.poll(async () => (await postState(lee))?.mailbox).toBe(0);
  await expect(leePost.getByTestId('post-mail-empty')).toBeVisible();

  // Lee gifts Sam 2 Timber (screen f); Sam picks it up from the mailbox.
  await leePost.getByTestId('post-tab-gift').tap();
  await leePost
    .getByTestId('post-gift-pick')
    .getByRole('button', { name: /Timber/ })
    .tap();
  await leePost.getByTestId('step-up-timber').tap();
  await expect.poll(async () => (await postState(lee))?.give).toBe(1);
  await leePost.getByTestId('post-send-gift').tap();
  await expect(leePost.getByTestId('post-note')).toHaveText(
    `Gift sent! ${samName} can pick it up at any post. 🎁`,
  );
  await expect(samPost.getByTestId('post-badge-mailbox')).toHaveText('1', { timeout: 15_000 });
  await samPost.getByTestId('post-tab-mailbox').tap();
  const gift = samPost.getByTestId('post-mail');
  await expect(gift).toContainText(`A gift from ${leeName}!`);
  await expect(gift).toContainText('Timber ×2');
  await gift.getByTestId('post-pickup').tap();
  await expect.poll(async () => (await postState(sam))?.mailbox).toBe(0);
  expect(findAvoidedWords((await samPost.textContent()) ?? '')).toEqual([]);

  // Close the post: the map is back.
  await samPost.getByTestId('post-close').tap();
  await expect(samPost).toBeHidden();

  expect(errors).toEqual([]);
  await lee.context().close();
  await sam.context().close();
});
