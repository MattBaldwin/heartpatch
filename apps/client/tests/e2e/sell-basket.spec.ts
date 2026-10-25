import { findAvoidedWords, HEART_COIN_RULES } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { grantItems, postState, visitPost, wordsSplit } from './trading.js';

/**
 * Selling at the trading post (#601 PR 4; #655 part C, the owner-approved
 * mockup v4): each row has its own − N +, the sticky bar shows what's picked,
 * what it pays and today's cap meter, and Sell opens one confirm sheet; ✨
 * Sell all spares opens the same sheet with every spare piece, trimmed to
 * today's room. Refusals land in the bar. Checked through the dev hook and
 * the DOM, never pixels.
 */

const SELL_CAP = HEART_COIN_RULES.dailyCaps.sell;

/** `PostDebug['sell']` from src/trading/post-screen.ts (this project can't see its types). */
interface SellDebug {
  soldToday: number;
  cap: number;
  lines: (
    | { kind: 'item'; itemId: string; lots: number }
    | { kind: 'clothing'; itemId: string; count: number }
  )[];
  confirm: 'basket' | 'spares' | null;
  barNote: string;
  sold: { coins: number; quantity: number } | null;
}

/** The post screen's dev hook, with the parts `PostDebug` (trading.ts) leaves out. */
const debug = async (page: Page) =>
  (await postState(page)) as unknown as {
    post: { q: number; r: number } | null;
    sell: SellDebug | null;
  } | null;
const sellState = async (page: Page) => (await debug(page))?.sell ?? null;

/** A new player with land by a post (dev route), their bag and wardrobe filled, at the post's Sell tab. */
async function seller(
  browser: Parameters<typeof newPlayer>[0],
  items: Record<string, number>,
  clothing: string[],
): Promise<{ page: Page; mapId: string; errors: string[] }> {
  const page = await newPlayer(browser, uniqueName('seller'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Market Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByTestId('lobby-invite-code')).toBeVisible();
  const mine = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = mine.body.maps.find((m) => m.name === 'Market Patch')!.id;
  expect((await api(page, 'POST', `/maps/${mapId}/dev/posts/connect`)).status).toBe(200);
  await grantItems(page, mapId, items);
  expect((await api(page, 'POST', '/dev/wardrobe/items', { items: clothing })).status).toBe(201);
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect
    .poll(async () => (await hook<{ live: string | null }>(page, 'map'))?.live, {
      timeout: 30_000,
    })
    .toBe('live');
  await visitPost(page);
  await page.getByTestId('post-tab-sell').tap();
  await expect(page.getByTestId('post-sell-today')).toBeVisible();
  return { page, mapId, errors };
}

/** Every box is inside the screen, between the safe-area insets. */
async function onScreen(page: Page, testIds: string[], inset = { top: 0, bottom: 0 }) {
  const { height } = page.viewportSize()!;
  for (const id of testIds) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.y, id).toBeGreaterThanOrEqual(inset.top);
    expect(box!.y + box!.height, id).toBeLessThanOrEqual(height - inset.bottom);
  }
}

test('sell: step two rows, the bar total updates, Sell opens the sheet, Sell! sells and shows the Yay card; nothing above the list is needed', async ({
  browser,
}) => {
  test.setTimeout(240_000); // the map build; CI renders in software
  const { page, mapId, errors } = await seller(browser, { timber: 23, greens: 3 }, [
    'pom-pom-beanie',
    'pom-pom-beanie',
    'pom-pom-beanie',
  ]);

  // Five tabs, picture over word, each whole on the phone.
  const tabsFit = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="post"] .post-tab')].every(
      (t) => t.scrollWidth <= t.clientWidth + 1,
    ),
  );
  expect(tabsFit).toBe(true);
  await expect(page.getByTestId('post-sell-today')).toHaveText(`💛 0 of ${String(SELL_CAP)} today`);
  await expect(page.getByTestId('post-sell-summary')).toHaveText('Nothing picked yet');
  await expect(page.getByTestId('post-sell-go')).toBeDisabled();
  // Not a whole lot of Greens (plus what a recipe keeps): the row says what's needed.
  await expect(page.getByTestId('post-sell-note-greens')).toHaveText(/^Need \d+$/);
  await expect(page.getByTestId('post-sell-more-greens')).toBeDisabled();
  await expect(page.getByTestId('post-sell-stays')).toContainText('stay with you');

  // Two lots of Timber and both spare beanies; the last beanie stays.
  await page.getByTestId('post-sell-more-timber').tap();
  await page.getByTestId('post-sell-more-timber').tap();
  await expect(page.getByTestId('post-sell-count-timber')).toHaveText('10');
  await expect(page.getByTestId('post-sell-note-timber')).toHaveText('2 💛');
  await page.getByTestId('post-sell-more-pom-pom-beanie').tap();
  await page.getByTestId('post-sell-more-pom-pom-beanie').tap();
  await expect(page.getByTestId('post-sell-count-pom-pom-beanie')).toHaveText('2');
  await expect(page.getByTestId('post-sell-more-pom-pom-beanie')).toBeDisabled();
  // The bar counts things, not rows, and the meter shows where today lands.
  await expect(page.getByTestId('post-sell-summary')).toHaveText('12 things · 6 💛');
  await expect(page.getByTestId('post-sell-meter-text')).toHaveText(
    `💛 0 → 6 of ${String(SELL_CAP)} today`,
  );
  expect((await sellState(page))?.lines).toEqual([
    { kind: 'item', itemId: 'timber', lots: 2 },
    { kind: 'clothing', itemId: 'pom-pom-beanie', count: 2 },
  ]);

  // Scrolled back to the top, the bar and its Sell are still on screen.
  await page.getByTestId('post').evaluate((sheet) => {
    sheet.scrollTop = 0;
  });
  await onScreen(page, ['post-sell-bar', 'post-sell-go']);

  // Sell opens the one sheet with every line; Not now keeps the basket.
  await page.getByTestId('post-sell-go').tap();
  const sheet = page.getByTestId('post-sell-confirm');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('post-sell-confirm-lines').locator('li')).toHaveText([
    /10 Timber\s*2 💛/,
    /2 Pom-Pom Beanies\s*4 💛/,
  ]);
  await expect(page.getByTestId('post-sell-confirm-total')).toHaveText(/12 things\s*\+6 💛/);
  await expect(page.getByTestId('post-sell-confirm-after')).toHaveText("You'll have 6 💛 after.");
  await expect(sheet).toContainText('No take-backs on a sale!');
  await onScreen(page, ['post-sell-confirm', 'post-sell-confirm-yes', 'post-sell-confirm-no']);
  await page.getByTestId('post-sell-confirm-no').tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('post-sell-summary')).toHaveText('12 things · 6 💛');

  await page.getByTestId('post-sell-go').tap();
  await page.getByTestId('post-sell-confirm-yes').tap();
  await expect(page.getByTestId('post-sell-done')).toContainText('Yay! +6 💛 for your patch!');
  await expect(page.getByTestId('post-sell-done')).toContainText(
    '10 Timber and 2 Pom-Pom Beanies sold.',
  );
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('post-sell-today')).toHaveText(`💛 6 of ${String(SELL_CAP)} today`);
  await expect(page.getByTestId('post-sell-summary')).toHaveText('Nothing picked yet');
  await expect(page.getByTestId('post-sell-meter-text')).toHaveText(
    `💛 6 of ${String(SELL_CAP)} today · ${String(SELL_CAP - 6)} to go`,
  );
  // The last beanie stays, so its row is gone.
  await expect(page.getByTestId('post-sell-count-pom-pom-beanie')).toHaveCount(0);

  const inventory = await api<{ items: Record<string, number> }>(
    page,
    'GET',
    `/maps/${mapId}/inventory`,
  );
  expect(inventory.body.items).toMatchObject({ timber: 13, greens: 3 });
  // The 💛 pill reads again after the sale.
  await expect
    .poll(async () => (await hook<{ balance: number | null }>(page, 'heartCoins'))?.balance)
    .toBe(6);
  expect(findAvoidedWords((await page.getByTestId('post').textContent()) ?? '')).toEqual([]);
  expect(await wordsSplit(page)).toEqual([]);

  // The bar's button clears the home-indicator inset: an iPhone 15's insets,
  // which Chromium can simulate (WebKit has no such switch).
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const inset = { top: 59, bottom: 34 };
    await cdp.send(
      'Emulation.setSafeAreaInsetsOverride' as never,
      { insets: { ...inset, left: 0, right: 0 } } as never,
    );
    await page.setViewportSize({ width: 393, height: 852 });
    await page.getByTestId('post-sell-more-timber').tap();
    await onScreen(page, ['post-sell-go', 'post-sell-meter'], inset);
    await page.getByTestId('post-sell-go').tap();
    await onScreen(page, ['post-sell-confirm-yes', 'post-sell-confirm-no'], inset);
  }

  expect(errors).toEqual([]);
  await page.context().close();
});

test("a basket that stopped fitting is refused in the bar and kept to today's room; sell all spares opens a sheet listing the trim", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { page, mapId, errors } = await seller(browser, { timber: 600, stone: 300 }, [
    'cloud-cape', // rare: 5 💛
    'cloud-cape',
    'pom-pom-beanie', // common: 2 💛
    'pom-pom-beanie',
    'pom-pom-beanie',
    'pom-pom-beanie',
  ]);
  // A cape and two beanies: 9 💛.
  await page.getByTestId('post-sell-more-cloud-cape').tap();
  await page.getByTestId('post-sell-more-pom-pom-beanie').tap();
  await page.getByTestId('post-sell-more-pom-pom-beanie').tap();
  await expect(page.getByTestId('post-sell-summary')).toHaveText('3 things · 9 💛');

  // Meanwhile another device sells 143 💛 of Timber and Stone: 7 💛 of room left.
  const at = (await debug(page))!.post!;
  const other = await api(page, 'POST', `/maps/${mapId}/posts/sell`, {
    kind: 'basket',
    q: at.q,
    r: at.r,
    lines: [
      { kind: 'item', itemId: 'timber', lots: 100 },
      { kind: 'item', itemId: 'stone', lots: 43 },
    ],
  });
  expect(other.status).toBe(200);

  // Sell! is refused whole; the reason is in the bar, nothing at the top.
  await page.getByTestId('post-sell-go').tap();
  await page.getByTestId('post-sell-confirm-yes').tap();
  await expect(page.getByTestId('post-sell-bar-note')).toHaveText(
    "Some of that won't fit today. Let's look again!",
  );
  await expect(page.getByTestId('post-note')).toBeHidden();
  await expect(page.getByTestId('post-sell-confirm')).toBeHidden();
  // The view reads again and the basket keeps its lines, cut to 7 💛.
  await expect(page.getByTestId('post-sell-today')).toHaveText(
    `💛 143 of ${String(SELL_CAP)} today`,
  );
  await expect(page.getByTestId('post-sell-summary')).toHaveText('2 things · 7 💛');
  expect((await sellState(page))?.lines).toEqual([
    { kind: 'clothing', itemId: 'cloud-cape', count: 1 },
    { kind: 'clothing', itemId: 'pom-pom-beanie', count: 1 },
  ]);

  // ✨ Sell all spares: rarer first, trimmed to the room, and the sheet says what waits.
  await page.getByTestId('post-sell-spares').tap();
  const sheet = page.getByTestId('post-sell-confirm');
  await expect(sheet).toContainText('Sell all spares? ✨');
  await expect(page.getByTestId('post-sell-confirm-lines').locator('li')).toHaveText([
    /1 Cloud Cape\s*5 💛/,
    /1 Pom-Pom Beanie\s*2 💛/,
  ]);
  await expect(page.getByTestId('post-sell-confirm-total')).toHaveText(/2 things\s*\+7 💛/);
  await expect(page.getByTestId('post-sell-confirm-after')).toHaveText(
    `💛 ${String(SELL_CAP)} of ${String(SELL_CAP)} today. All full!`,
  );
  await expect(page.getByTestId('post-sell-confirm-stays')).toContainText('Keeps 1 of each ✨');
  await expect(page.getByTestId('post-sell-confirm-stays')).toContainText(
    "2 Pom-Pom Beanies won't fit today. They'll wait for you!",
  );
  expect((await sellState(page))?.confirm).toBe('spares');
  await page.getByTestId('post-sell-confirm-yes').tap();
  await expect(page.getByTestId('post-sell-done')).toContainText('Yay! +7 💛 for your patch!');
  await expect(page.getByTestId('post-sell-done')).toContainText(
    '1 Cloud Cape and 1 Pom-Pom Beanie sold.',
  );
  await expect(page.getByTestId('post-sell-today')).toHaveText(
    `💛 ${String(SELL_CAP)} of ${String(SELL_CAP)} today`,
  );
  // Capped: the card says so, nothing more goes in, and the easy button rests.
  await expect(page.getByTestId('post-sell-capped')).toBeVisible();
  await expect(page.getByTestId('post-sell-summary')).toHaveText('Nothing picked yet');
  await expect(page.getByTestId('post-sell-more-pom-pom-beanie')).toBeDisabled();
  await expect(page.getByTestId('post-sell-spares')).toBeDisabled();
  // One cape and two beanies stay in the wardrobe (one of each kept, two waiting).
  expect((await sellState(page))?.soldToday).toBe(SELL_CAP);
  expect(findAvoidedWords((await page.getByTestId('post').textContent()) ?? '')).toEqual([]);

  expect(errors).toEqual([]);
  await page.context().close();
});
