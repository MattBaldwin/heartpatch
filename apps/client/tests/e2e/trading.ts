import { expect, type Browser, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { traysState } from './trays.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

// Trading post helpers shared by trading-posts.spec.ts (#271) and
// trade-split.spec.ts (#305): two patch-mates whose land reaches a post, and
// the post screen's dev-hook state and layout checks.

/** `PostDebug` from src/trading/post-screen.ts (this project can't see its types). */
export interface PostDebug {
  open: boolean;
  tab: 'trade' | 'gift' | 'mailbox';
  mate: string | null;
  give: number;
  want: number;
  offersToMe: number;
  offersFromMe: number;
  mailbox: number;
  working: boolean;
  meter: { tip: 'none' | 'even' | 'me' | 'them'; lopsided: boolean; give: number; get: number };
  filters: { mine: string; theirs: string };
  sorts: { mine: string; theirs: string };
}
export const postState = (page: Page) => hook<PostDebug>(page, 'post');

const posts = (page: Page) =>
  hook<{ onScreen: { name: string; x: number; y: number }[] }>(page, 'posts');
const mapState = (page: Page) => hook<{ live: string | null }>(page, 'map');

/**
 * Names on the post screen whose words break across lines, e.g. "Pebblesno"
 * then "oze": each word's text range should draw on a single line box.
 */
export function wordsSplit(page: Page): Promise<string[]> {
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
export function namesClipped(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="post"] .post-fit')]
      .filter((n) => !n.classList.contains('post-ellipsis') && n.scrollWidth > n.clientWidth + 1)
      .map((n) => n.textContent),
  );
}

/** Shelf tiles whose contents stick out of their own cell (e.g. a picked item's stepper). */
export function tilesSpill(page: Page): Promise<string[]> {
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
export async function shutTrays(page: Page): Promise<void> {
  const open = (await traysState(page))?.open ?? null;
  if (open === null) return;
  await page.getByTestId(`tray-handle-${open}`).tap();
  await expect.poll(async () => (await traysState(page))?.open, { timeout: 15_000 }).toBeNull();
}

/** Taps the post my land reaches (its flag says 🔗) and goes in with "Visit post". */
export async function visitPost(page: Page): Promise<void> {
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

export interface Traders {
  lee: Page;
  sam: Page;
  leeName: string;
  samName: string;
  mapId: string;
  /** Page errors from either player; a spec expects none. */
  errors: string[];
}

/**
 * Lee makes a patch called `patchName` and Sam joins it; each one's land
 * reaches a post (dev route, unless `posts` is false: friendly.spec.ts), and
 * both are on the live map.
 */
export async function twoTraders(
  browser: Browser,
  patchName: string,
  { posts = true }: { posts?: boolean } = {},
): Promise<Traders> {
  const leeName = uniqueName('lee');
  const samName = uniqueName('sam');
  const lee = await newPlayer(browser, leeName);
  const sam = await newPlayer(browser, samName);
  const errors: string[] = [];
  for (const page of [lee, sam]) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    page.on('pageerror', (err) => errors.push(err.message));
  }
  const leeLobby = lee.getByTestId('lobby');
  await leeLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await leeLobby.getByLabel('Patch name').fill(patchName);
  await leeLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await leeLobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  const mine = await api<{ maps: { id: string; name: string }[] }>(lee, 'GET', '/maps');
  const mapId = mine.body.maps.find((m) => m.name === patchName)!.id;
  if (posts) expect((await api(lee, 'POST', `/maps/${mapId}/dev/posts/connect`)).status).toBe(200);

  const samLobby = sam.getByTestId('lobby');
  await samLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await samLobby.getByLabel('Invite code').fill(code);
  await samLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(samLobby.getByTestId('lobby-waiting')).toBeVisible();
  await visitPatch(leeLobby);
  await expect(leeLobby).toBeHidden();
  await lee.getByTestId('lobby-open').tap();
  await leeLobby.getByRole('button', { name: new RegExp(patchName) }).tap();
  await leeLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(leeLobby.getByTestId('lobby-notice')).toContainText(`${samName} joined`);
  await visitPatch(leeLobby);
  await expect(leeLobby).toBeHidden();
  await samLobby.getByRole('button', { name: new RegExp(patchName) }).tap({ timeout: 30_000 });
  if (posts) expect((await api(sam, 'POST', `/maps/${mapId}/dev/posts/connect`)).status).toBe(200);
  await visitPatch(samLobby);
  await expect(samLobby).toBeHidden();
  for (const page of [lee, sam]) {
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
    await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  }
  return { lee, sam, leeName, samName, mapId, errors };
}

/** Gives a player a squishy (dev route). */
export async function grantSquishy(
  page: Page,
  mapId: string,
  speciesId: string,
  level: number,
): Promise<void> {
  const res = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, { speciesId, level });
  expect(res.status).toBe(201);
}

/** Gives a player some items (dev route). */
export async function grantItems(
  page: Page,
  mapId: string,
  items: Record<string, number>,
): Promise<void> {
  expect((await api(page, 'POST', `/maps/${mapId}/dev/items`, { items })).status).toBe(201);
}
