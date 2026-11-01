import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { pushStubCounts, setPushStub, stubPush } from './push-stub.js';

// Push nudges (#726): the offer card and Settings › Nudges. The server runs
// with HP_PUSH=on (playwright.config.ts); the page stands in an iPhone Home
// Screen app with push (push-stub.ts), since a browser can't get a real push.

async function makePatch(page: Page, name = 'Nudge Patch', firstTime = true): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill(name);
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // Sprout's first-time tray hint owns the screen until it's answered.
  if (firstTime) await page.getByTestId('tray-hint-ok').tap();
}

/** The offer looked on this load, with a patch up, and found it asked already. */
async function offerDone(page: Page): Promise<void> {
  await expect
    .poll(async () => (await hook<{ offer: string }>(page, 'push'))?.offer, { timeout: 30_000 })
    .toBe('done');
}

async function openSettings(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await page.getByTestId('keeper-menu').tap();
  await page.getByRole('button', { name: 'Settings' }).tap();
  return page.getByTestId('lobby').getByTestId('push-settings');
}

test('the offer shows once in a Home Screen app, and Yes please turns nudges on', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('nudge'));
  await stubPush(page);
  await page.reload();
  await makePatch(page);

  const card = page.getByTestId('push-offer');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(
    card.getByRole('heading', { name: 'Want a nudge when night falls? 🔥' }),
  ).toBeVisible();
  const put = page.waitForRequest(
    (r) => r.url().endsWith('/api/v1/push/subscription') && r.method() === 'PUT',
  );
  await card.getByRole('button', { name: 'Yes please' }).tap();
  await put;
  await expect(card).toBeHidden();
  await expect(page.getByTestId('patch-line')).toHaveText('Nudges on! 🔔');
  expect(await pushStubCounts(page)).toEqual({ requests: 1, subscribes: 1 });

  // Settings shows the real state: on, with the switches (and the Long Night's,
  // since a new patch has a Long Night day).
  const settings = await openSettings(page);
  await expect(settings).toHaveAttribute('data-state', 'on');
  const friend = settings.getByRole('button', { name: 'A friend is here' });
  await expect(friend).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'The Long Night' })).toBeVisible();
  const saved = page.waitForRequest(
    (r) => r.url().endsWith('/api/v1/push/settings') && r.method() === 'PUT',
  );
  await friend.tap();
  expect((await saved).postDataJSON()).toEqual({ friend: false });
  await expect(friend).toHaveAttribute('aria-pressed', 'false');

  // Off stops nudges on this device; On again needs no second prompt.
  const gone = page.waitForRequest(
    (r) => r.url().endsWith('/api/v1/push/subscription') && r.method() === 'DELETE',
  );
  await settings.getByTestId('push-toggle').tap();
  await gone;
  await expect(settings).toHaveAttribute('data-state', 'off');
  await settings.getByTestId('push-toggle').tap();
  await expect(settings).toHaveAttribute('data-state', 'on');
  // No second iPhone question: permission was granted already.
  expect(await pushStubCounts(page)).toEqual({ requests: 1, subscribes: 2 });
  // The switch kept what was saved.
  await expect(settings.getByRole('button', { name: 'A friend is here' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // Tapping a nudge while the app is open opens its patch, as "Visit patch" does.
  const mapId = async () => (await hook<{ id: string }>(page, 'map'))?.id ?? null;
  const first = await mapId();
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await makePatch(page, 'Second Patch', false);
  await expect.poll(mapId).not.toBe(first);
  // What the service worker posts on `notificationclick` (messages.ts `PageMessage`).
  await page.evaluate((id) => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', { data: { type: 'open-map', mapId: id } }),
    );
  }, first);
  await expect.poll(mapId, { timeout: 30_000 }).toBe(first);
  await expect(lobby).toBeHidden();

  // A new launch on this device never offers again.
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await offerDone(page);
  await expect(card).toBeHidden();
  await page.context().close();
});

test('no offer in a plain tab; Not now is for good; Settings shows each state', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('nudgetab'));
  await stubPush(page, { standalone: false });
  await page.reload();
  await makePatch(page);

  // A plain Safari tab: no card (it never even asks the server), and
  // Settings says how to get one.
  expect((await hook<{ offer: string }>(page, 'push'))?.offer).toBe('idle');
  await expect(page.getByTestId('push-offer')).toBeHidden();
  let settings = await openSettings(page);
  await expect(settings).toHaveAttribute('data-state', 'install');
  await expect(settings).toContainText('Add to Home Screen first');
  await settings.getByRole('button', { name: 'Show me how' }).tap();
  await expect(settings.getByText('Pick “Add to Home Screen”.')).toBeVisible();

  // The Home Screen app: the card, then "Not now", then never again.
  await setPushStub(page, { standalone: true });
  await page.reload();
  const card = page.getByTestId('push-offer');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Not now' }).tap();
  await expect(card).toBeHidden();
  expect(await pushStubCounts(page)).toEqual({ requests: 0, subscribes: 0 });
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await offerDone(page);
  await expect(card).toBeHidden();

  // Not asked yet (or granted, after a logout): Off, offering On.
  settings = await openSettings(page);
  await expect(settings).toHaveAttribute('data-state', 'off');
  await expect(settings.getByTestId('push-toggle')).toHaveText('Off');

  // iOS said no: "Off in iPhone Settings", and where to change it. No control.
  await setPushStub(page, { permission: 'denied' });
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  settings = await openSettings(page);
  await expect(settings).toHaveAttribute('data-state', 'blocked');
  await expect(settings).toContainText('Off in iPhone Settings');
  await expect(settings).toContainText('Settings › Notifications › Heartpatch');
  await expect(settings.getByTestId('push-toggle')).toHaveCount(0);

  // Push off for this player (NOT_FOUND): the whole group stays out.
  await page.route('**/api/v1/push', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not here!' } }),
    }),
  );
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const asked = page.waitForResponse((r) => r.url().endsWith('/api/v1/push'));
  await page.getByTestId('keeper-menu').tap();
  await page.getByRole('button', { name: 'Settings' }).tap();
  expect((await asked).status()).toBe(404);
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByTestId('audio-settings')).toBeVisible();
  await expect(lobby.getByTestId('push-settings')).toHaveCount(0);
  await page.context().close();
});
