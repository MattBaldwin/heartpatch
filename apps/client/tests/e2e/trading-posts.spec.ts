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
  await expect(page.getByTestId('post-visit')).toBeVisible();
  await expect(page.getByTestId('journey-preview')).toHaveCount(0);
  expect((await journeyState(page))!.passes).toEqual([`${String(trip.q)},${String(trip.r)}`]);

  expect(errors).toEqual([]);
  await page.context().close();
});

/** `PostDebug` from src/trading/post-screen.ts. */
interface PostDebug {
  open: boolean;
  tab: 'trade' | 'gift' | 'mailbox';
  mate: string | null;
  give: number;
  want: number;
  offersToMe: number;
  offersFromMe: number;
  mailbox: number;
  working: boolean;
}
const postState = (page: Page) => hook<PostDebug>(page, 'post');

/**
 * Names on the post screen whose words break across lines, e.g. "Pebblesno"
 * then "oze": each word's text range should draw on a single line box.
 */
function wordsSplit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const split: string[] = [];
    for (const node of document.querySelectorAll('[data-testid="post"] .post-fit')) {
      const text = node.firstChild;
      if (!(text instanceof Text)) continue;
      let at = 0;
      for (const word of text.data.split(' ')) {
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + word.length);
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        if (tops.size > 1) split.push(word);
        at += word.length + 1;
      }
    }
    return split;
  });
}

/** Names cut off without a "…": wider than their box after fitting. */
function namesClipped(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="post"] .post-fit')]
      .filter((n) => !n.classList.contains('post-ellipsis') && n.scrollWidth > n.clientWidth + 1)
      .map((n) => n.textContent),
  );
}

/** Shelf tiles whose contents stick out of their own cell (e.g. a picked item's stepper). */
function tilesSpill(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="post"] .post-grid > *')].flatMap(
      (cell) => {
        const edge = cell.getBoundingClientRect().right + 1;
        const out = [...cell.querySelectorAll<HTMLElement>('*')].some(
          (n) => n.getBoundingClientRect().right > edge,
        );
        return out ? [cell.textContent] : [];
      },
    ),
  );
}

/** Shuts an open side tray, which covers part of the map and the tile panel. */
async function shutTrays(page: Page): Promise<void> {
  const open = (await traysState(page))?.open ?? null;
  if (open === null) return;
  await page.getByTestId(`tray-handle-${open}`).tap();
  await expect.poll(async () => (await traysState(page))?.open, { timeout: 15_000 }).toBeNull();
}

/** Taps the post my land reaches (its flag says 🔗) and goes in with "Visit post". */
async function visitPost(page: Page): Promise<void> {
  await shutTrays(page);
  const flag = page.getByTestId('post-flag').filter({ hasText: /^🔗 / }).first();
  await expect(flag).toBeVisible({ timeout: 30_000 });
  const name = ((await flag.textContent()) ?? '').replace(/^🔗 /, '');
  const spot = (await posts(page))!.onScreen.find((p) => p.name === name)!;
  await tapCanvas(page, spot.x, spot.y);
  await expect(page.getByTestId('tile-panel').locator('#tile-panel-title')).toHaveText(name);
  await page.getByTestId('post-visit').tap();
  await expect(page.getByTestId('post')).toBeVisible();
  await expect(page.getByTestId('post-chip')).toHaveText('🔗 Connected');
  await expect.poll(async () => (await postState(page))?.open).toBe(true);
}

test('trades and gifts at a post: offer, say yes, and pick up from the mailbox (#271)', async ({
  browser,
}) => {
  test.setTimeout(300_000); // two players, two map builds; CI renders in software
  const leeName = uniqueName('lee');
  const samName = uniqueName('sam');

  // Lee makes a patch, Sam joins; each one's land reaches a post (dev route).
  const lee = await newPlayer(browser, leeName);
  const sam = await newPlayer(browser, samName);
  const errors: string[] = [];
  for (const page of [lee, sam]) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    page.on('pageerror', (err) => errors.push(err.message));
  }
  const leeLobby = lee.getByTestId('lobby');
  await leeLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await leeLobby.getByLabel('Patch name').fill('Swap Patch');
  await leeLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await leeLobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  const mine = await api<{ maps: { id: string; name: string }[] }>(lee, 'GET', '/maps');
  const mapId = mine.body.maps.find((m) => m.name === 'Swap Patch')!.id;
  expect((await api(lee, 'POST', `/maps/${mapId}/dev/posts/connect`)).status).toBe(200);

  const samLobby = sam.getByTestId('lobby');
  await samLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await samLobby.getByLabel('Invite code').fill(code);
  await samLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(samLobby.getByTestId('lobby-waiting')).toBeVisible();
  await visitPatch(leeLobby);
  await expect(leeLobby).toBeHidden();
  await lee.getByTestId('lobby-open').tap();
  await leeLobby.getByRole('button', { name: /Swap Patch/ }).tap();
  await leeLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(leeLobby.getByTestId('lobby-notice')).toContainText(`${samName} joined`);
  await visitPatch(leeLobby);
  await expect(leeLobby).toBeHidden();
  await samLobby.getByRole('button', { name: /Swap Patch/ }).tap({ timeout: 30_000 });
  expect((await api(sam, 'POST', `/maps/${mapId}/dev/posts/connect`)).status).toBe(200);
  await visitPatch(samLobby);
  await expect(samLobby).toBeHidden();
  for (const page of [lee, sam]) {
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
    await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  }
  // Lee has a friend to trade (the patch starter stays) and some Timber; Sam has Stone.
  const pet = await api(lee, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'emberbun',
    level: 9,
  });
  expect(pet.status).toBe(201);
  expect(
    (await api(lee, 'POST', `/maps/${mapId}/dev/items`, { items: { timber: 3 } })).status,
  ).toBe(201);
  const long = await api(sam, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'pebblesnooze',
    level: 7,
  });
  expect(long.status).toBe(201);
  expect((await api(sam, 'POST', `/maps/${mapId}/dev/items`, { items: { stone: 2 } })).status).toBe(
    201,
  );

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
