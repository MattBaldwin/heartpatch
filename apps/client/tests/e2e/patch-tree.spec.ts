import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, WebSocketRoute } from '@playwright/test';
import { expect, test } from './test.js';
import { hook, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { shutTrays } from './trading.js';

/**
 * The Patch Tree on an iPhone and an iPad (#37 2d). The server's rules are
 * its own tests' (modules/tree); December isn't on the suite's clock, so the
 * map view is answered here with a tree at the trading post nearest my home
 * (standing in for the server's pick) and must still parse as the shared
 * contract. Checks: it stands at that post, never over a label (owner
 * decision 2026-11-27, item 1), a live `tree.decorated` hangs ornaments and
 * lights the star without a refetch, and a patch-mate's card shows hearts of
 * warmth. With `HP_TREE_SHOTS=<dir>` it also saves the render-check frames.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface TreeDebug {
  postIndex: number;
  ornaments: number;
  starLit: boolean;
  lit: boolean;
  rect: Box | null;
  tileRect: Box | null;
}
interface MapDebug {
  id: string;
  viewSeq: number;
  live: string | null;
  tree?: TreeDebug | null;
}
const mapState = (page: Page) => hook<MapDebug>(page, 'map');

/** Labels the tree must never cover: post and home flags, tile marks, the HUD, the legend, night chips. */
const LABELS = [
  '.post-flag',
  '.tile-mark',
  '[data-testid="map-hud"]',
  '[data-testid="map-legend-button"]',
  '[data-testid="night-chips"]',
  '.eve-chip',
  '[data-testid="patch-line"]',
].join(', ');

const MATE = '0190a8c4-0000-7000-8000-00000000a7e1';

interface Tree {
  ornaments: number;
  starLit: boolean;
}

/**
 * Answers the map view with the tree at the post nearest my Heart Seed and
 * warmth with one patch-mate, the night as `night`, and the stats with that
 * patch-mate on them. Returns the post's index once the view has been asked for.
 */
async function stubTree(page: Page, tree: Tree, night: boolean) {
  const seen: { postIndex: number | null } = { postIndex: null };
  await page.route('**/api/v1/maps/*/view', async (route) => {
    const res = await route.fetch();
    const view = (await res.json()) as {
      tiles: { q: number; r: number; homeSlot: number | null; ownerUserId: string | null }[];
      posts?: { q: number; r: number; index: number }[];
      christmas?: Record<string, unknown>;
    };
    const home = view.tiles.filter((t) => t.homeSlot !== null && t.ownerUserId !== null);
    const dist = (a: { q: number; r: number }, b: { q: number; r: number }) =>
      (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    // The middle of my home ring (my Heart Seed), where the camera starts: the
    // post nearest it shows mid-screen, clear of the side trays' handles.
    const mid = {
      q: Math.round(home.reduce((n, t) => n + t.q, 0) / Math.max(1, home.length)),
      r: Math.round(home.reduce((n, t) => n + t.r, 0) / Math.max(1, home.length)),
    };
    const near = (p: { q: number; r: number }) => dist(mid, p);
    const post = [...(view.posts ?? [])].sort((a, b) => near(a) - near(b))[0];
    if (post) {
      seen.postIndex = post.index;
      view.christmas = {
        presentWaiting: false,
        tree: { postIndex: post.index, ...tree },
        warmth: [{ userId: MATE, warmth: 3 }],
      };
    }
    await route.fulfill({ response: res, json: view });
  });
  await page.route('**/api/v1/maps/*/hollow', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { hollow: { night: { isNight: boolean } } };
    body.hollow.night.isNight = night;
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/api/v1/maps/*/stats', async (route) => {
    const res = await route.fetch();
    const stats = (await res.json()) as {
      keepers: { user: { id: string; username: string }; homeSlot: number | null }[];
    };
    const me = stats.keepers[0];
    if (me) {
      stats.keepers.push({ ...me, user: { id: MATE, username: 'pip' }, homeSlot: 1 });
    }
    await route.fulfill({ response: res, json: stats });
  });
  return seen;
}

/** The live socket, passed through to the server, so a test can add an event of its own. */
async function tapSocket(page: Page): Promise<{ socket: WebSocketRoute | null }> {
  const tap: { socket: WebSocketRoute | null } = { socket: null };
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    ws.connectToServer();
    tap.socket = ws;
  });
  return tap;
}

async function openPatch(page: Page, name: string): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill(name);
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForLiveMap(page);
  await shutTrays(page);
}

/** Visible labels whose box meets the tree's (with a 2 px gap), by what they are. */
async function labelsUnderTree(page: Page, rect: Box): Promise<string[]> {
  return page.evaluate(
    ({ selector, rect }) => {
      const gap = 2;
      const hits: string[] = [];
      for (const node of document.querySelectorAll<HTMLElement>(selector)) {
        if (node.hidden || node.getClientRects().length === 0) continue;
        const b = node.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        const meets =
          b.left < rect.x + rect.width + gap &&
          b.right > rect.x - gap &&
          b.top < rect.y + rect.height + gap &&
          b.bottom > rect.y - gap;
        if (meets)
          hits.push(
            `${node.className || node.dataset['testid'] || node.tagName}: ${node.textContent}`,
          );
      }
      return hits;
    },
    { selector: LABELS, rect },
  );
}

async function treeOnScreen(page: Page): Promise<TreeDebug> {
  await expect
    .poll(async () => (await mapState(page))?.tree?.rect ?? null, { timeout: 30_000 })
    .not.toBeNull();
  return (await mapState(page))!.tree!;
}

const shots = process.env['HP_TREE_SHOTS'];

async function shoot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  // Let the flags and marks settle on their spots first (they follow the frame).
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, `${test.info().project.name}-${name}.png`) });
}

test.describe('the Patch Tree (#37 2d)', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const [ornaments, starLit, night] of [
    [0, false, true],
    [6, false, true],
    [12, true, true],
    [6, false, false],
  ] as const) {
    const when = night ? 'night' : 'day';
    test(`stands at its post with ${String(ornaments)} ornaments by ${when}, over no label`, async ({
      browser,
    }) => {
      const page = await newPlayer(browser, uniqueName('tree'));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const seen = await stubTree(page, { ornaments, starLit }, night);
      // The quality tier pinned (dev `?tier=`, governor off), so a slow runner's frames stay sharp.
      await page.goto('/?tier=high');
      await openPatch(page, 'Tree Patch');
      const tree = await treeOnScreen(page);
      expect(tree).toMatchObject({ postIndex: seen.postIndex, ornaments, starLit, lit: night });
      // Inside its own tile, under the tile's top edge (where the post's flag sits).
      if (!tree.rect || !tree.tileRect) throw new Error('no tree rect');
      expect(tree.rect.y).toBeGreaterThanOrEqual(tree.tileRect.y);
      expect(tree.rect.x).toBeGreaterThanOrEqual(tree.tileRect.x);
      expect(tree.rect.x + tree.rect.width).toBeLessThanOrEqual(
        tree.tileRect.x + tree.tileRect.width,
      );
      // Its post's flag is up, and no label is under the tree.
      await expect(page.locator('.post-flag').filter({ visible: true }).first()).toBeVisible();
      expect(await labelsUnderTree(page, tree.rect)).toEqual([]);
      // On screen, not just in front of the camera.
      const screen = page.viewportSize()!;
      expect(tree.rect.x).toBeGreaterThanOrEqual(0);
      expect(tree.rect.y).toBeGreaterThanOrEqual(0);
      expect(tree.rect.x + tree.rect.width).toBeLessThanOrEqual(screen.width);
      expect(tree.rect.y + tree.rect.height).toBeLessThanOrEqual(screen.height);
      await shoot(page, `${when}-${String(ornaments)}`);
      await page.context().close();
    });
  }

  test('hangs a live ornament and lights the star without a refetch, naming no one', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('deco'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const views: string[] = [];
    page.on('request', (r) => {
      if (/\/maps\/[^/]+\/view/.test(r.url())) views.push(r.url());
    });
    // The socket opened at sign-in: tap it, then load the page again so it opens through the tap.
    const tap = await tapSocket(page);
    await page.reload();
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
    const seen = await stubTree(page, { ornaments: 10, starLit: false }, false);
    await openPatch(page, 'Deco Patch');
    const before = await treeOnScreen(page);
    expect(before).toMatchObject({ ornaments: 10, starLit: false, lit: false });
    const asked = views.length;
    const map = (await mapState(page))!;
    const decorated = (seq: number, total: number, lit: boolean) =>
      JSON.stringify({
        v: 1,
        type: 'tree.decorated',
        mapId: map.id,
        seq,
        at: new Date().toISOString(),
        data: {
          postIndex: seen.postIndex,
          fromUserId: MATE,
          toUserId: MATE,
          source: 'gift',
          added: 1,
          ornaments: total,
          starLit: lit,
        },
      });
    expect(tap.socket).not.toBeNull();
    tap.socket!.send(decorated(map.viewSeq + 1, 11, false));
    await expect.poll(async () => (await mapState(page))?.tree?.ornaments).toBe(11);
    // The line names the fun, never who gave whom (on the patch line, in its turn).
    const beat = page.getByTestId('patch-line');
    await expect(beat).toHaveText(
      'An ornament went up on the Patch Tree! 🎄 1 more to light the star!',
      { timeout: 15_000 },
    );
    expect(await beat.textContent()).not.toContain('pip');
    tap.socket!.send(decorated(map.viewSeq + 2, 12, true));
    await expect.poll(async () => (await mapState(page))?.tree?.starLit).toBe(true);
    await expect(beat).toHaveText('The star on the Patch Tree is lit! ⭐', { timeout: 15_000 });
    // No refetch for either.
    expect(views.length).toBe(asked);
    await page.context().close();
  });

  test("shows hearts of warmth on a patch-mate's card, not on mine", async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('warm'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubTree(page, { ornaments: 6, starLit: false }, false);
    await openPatch(page, 'Warm Patch');
    await page.getByTestId('map-legend-button').tap();
    await page.getByTestId('map-legend-stats').tap();
    const cards = page.getByTestId('patch-stats-keeper');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByTestId('patch-stats-hearts')).toHaveCount(0);
    const hearts = cards.nth(1).getByTestId('patch-stats-hearts');
    await expect(hearts).toHaveText('💗💗💗');
    await expect(hearts).toHaveAttribute('aria-label', '3 hearts of warmth');
    // The 14 px text floor (owner decision 2026-11-27, item 6).
    const size = await hearts.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThanOrEqual(14);
    await cards.nth(1).scrollIntoViewIfNeeded();
    await shoot(page, 'hearts');
    await page.context().close();
  });
});
