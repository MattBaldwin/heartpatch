import { expect, test, type Page } from '@playwright/test';
import { api, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { visitPost } from './trading.js';

/**
 * The trading post's Shop (#729c, the owner-approved mockup v3): a card per
 * item with its price, the confirm sheet before anything is spent, a receipt
 * after, and a glowing Find a squishy while a Rare Lure is held. Checked
 * through the DOM, never pixels.
 */

async function shopper(browser: Parameters<typeof newPlayer>[0], coins: number) {
  const page = await newPlayer(browser, uniqueName('shopper'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Shop Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByTestId('lobby-invite-code')).toBeVisible();
  const mine = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = mine.body.maps.find((m) => m.name === 'Shop Patch')!.id;
  expect((await api(page, 'POST', `/maps/${mapId}/dev/posts/connect`)).status).toBe(200);
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/heart-coins`, { amount: coins })).status,
  ).toBe(201);
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForLiveMap(page);
  await visitPost(page);
  // The post's hex, read from the shop's own request (the page doesn't expose it).
  const seen = page.waitForRequest((r) => r.url().includes('/posts/shop?'));
  await page.getByTestId('post-tab-shop').tap();
  const at = new URL((await seen).url()).searchParams;
  await expect(page.getByTestId('post-shop-list')).toBeVisible();
  return { page, mapId, errors, at };
}

const card = (page: Page, id: string) =>
  page.locator(`[data-testid="post-shop-list"] [data-item="${id}"]`);

test('shop: six tabs fit, cards show the server prices, a lure buy goes confirm → receipt → glow', async ({
  browser,
}) => {
  test.setTimeout(240_000); // the map build; CI renders in software
  const { page, errors } = await shopper(browser, 130);

  // Six tabs, each whole on the phone; Mailbox is "Mail".
  const tabsFit = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="post"] .post-tab')].every(
      (t) => t.scrollWidth <= t.clientWidth + 1,
    ),
  );
  expect(tabsFit).toBe(true);
  await expect(page.getByTestId('post-tab-mailbox')).toContainText('Mail');
  await expect(page.getByTestId('post-shop-balance')).toHaveText('💛 130');

  // 130 buys the lure (120); the crate (60) and the pack are still on offer but 130 can't cover both.
  await expect(card(page, 'rare-lure')).toHaveAttribute('data-state', 'buy');
  await expect(page.getByTestId('post-shop-buy-rare-lure')).toBeEnabled();
  await expect(card(page, 'potion-crate')).toHaveAttribute('data-state', 'buy');
  await expect(page.getByTestId('post-shop-buy-heart-charm-pack')).toBeEnabled();

  await page.getByTestId('post-shop-buy-rare-lure').tap();
  const sheet = page.getByTestId('post-shop-confirm');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Buy a Rare Lure for 💛 120?');
  await expect(sheet).toContainText("You'll have 💛 10 after.");

  // Not now spends nothing.
  await page.getByTestId('post-shop-confirm-no').tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('post-shop-balance')).toHaveText('💛 130');

  await page.getByTestId('post-shop-buy-rare-lure').tap();
  await page.getByTestId('post-shop-confirm-yes').tap();
  await expect(page.getByTestId('post-shop-done')).toContainText('Your lure is ready');
  await expect(page.getByTestId('post-shop-balance')).toHaveText('💛 10');
  await expect(card(page, 'rare-lure')).toHaveAttribute('data-state', 'held');
  await expect(page.getByTestId('post-shop-buy-rare-lure')).toBeDisabled();
  await expect(page.getByTestId('post-shop-state-rare-lure')).toHaveText(
    "You've got a lure waiting ✨",
  );
  // Not enough left for the pack: the card says how many more.
  await expect(page.getByTestId('post-shop-why-heart-charm-pack')).toHaveText('Need 💛 30 more');

  // Closed, Find a squishy glows with the lure's note.
  await page.getByTestId('post-close').tap();
  const find = page.getByTestId('battle-entry');
  await expect(find).toHaveClass(/battle-entry-lure/);
  expect(errors).toEqual([]);
});

test('shop: a capped pack says back tomorrow and its Buy greys out', async ({ browser }) => {
  test.setTimeout(240_000);
  const { page } = await shopper(browser, 500);
  // Buy the pack, then the cap says come back tomorrow.
  await page.getByTestId('post-shop-buy-heart-charm-pack').tap();
  await page.getByTestId('post-shop-confirm-yes').tap();
  await expect(page.getByTestId('post-shop-done')).toBeVisible();
  await expect(page.getByTestId('post-shop-state-heart-charm-pack')).toHaveText(
    'Back tomorrow! 🌙',
  );
  await expect(page.getByTestId('post-shop-buy-heart-charm-pack')).toBeDisabled();
});

test("shop: a refused purchase keeps the server's words after the card re-reads", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { page, mapId, at } = await shopper(browser, 500);
  // Another device buys the day's pack first; this card is now stale.
  const first = await page.evaluate(
    async ({ mapId, q, r }) => {
      const res = await fetch(`/api/v1/maps/${mapId}/posts/shop`, {
        method: 'POST',
        headers: {
          'x-requested-with': 'heartpatch',
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ q: Number(q), r: Number(r), itemId: 'heart-charm-pack' }),
      });
      return res.status;
    },
    { mapId, q: at.get('q'), r: at.get('r') },
  );
  expect(first).toBe(200);
  await page.getByTestId('post-shop-buy-heart-charm-pack').tap();
  await page.getByTestId('post-shop-confirm-yes').tap();
  // The re-read redraws the card as capped, and the refusal stays up.
  await expect(page.getByTestId('post-shop-state-heart-charm-pack')).toHaveText(
    'Back tomorrow! 🌙',
  );
  await expect(page.getByTestId('post-shop-note')).toBeVisible();
  await expect(page.getByTestId('post-shop-note')).not.toHaveText('');
  await expect(page.getByTestId('post-shop-done')).toBeHidden();
});

test('shop: Night supplies and the Fence patch kit, with nothing to stock or fix, say so and charge nothing (729b)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { page, errors } = await shopper(browser, 200);
  await expect(card(page, 'night-supplies')).toContainText('Night supplies');
  await expect(card(page, 'night-supplies')).toContainText('1 a week');
  await expect(card(page, 'fence-patch-kit')).toContainText('Fence patch kit');

  // A new patch has no fires: the server's words, and the coins stay.
  await page.getByTestId('post-shop-buy-night-supplies').tap();
  await expect(page.getByTestId('post-shop-confirm')).toContainText(
    'Buy Night supplies for 💛 80?',
  );
  await page.getByTestId('post-shop-confirm-yes').tap();
  await expect(page.getByTestId('post-shop-note')).toHaveText('No fires to stock yet 🔥');
  await expect(page.getByTestId('post-shop-done')).toBeHidden();
  await expect(page.getByTestId('post-shop-balance')).toHaveText('💛 200');

  // No fences either.
  await page.getByTestId('post-shop-buy-fence-patch-kit').tap();
  await page.getByTestId('post-shop-confirm-yes').tap();
  await expect(page.getByTestId('post-shop-note')).toHaveText('No fences to fix yet 🪵');
  await expect(page.getByTestId('post-shop-balance')).toHaveText('💛 200');
  expect(errors).toEqual([]);
});
