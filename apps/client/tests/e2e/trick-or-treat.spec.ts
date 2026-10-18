import { expect, test, type Page } from '@playwright/test';
import { selectTile } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Trick-or-treat on the map (#515 part B): two Keepers on one patch; one
 * knocks on the other's Heart Seed, gets a treat, and the button turns to
 * "Visited today". The host's morning report counts yesterday's visitors, so
 * the spec stands in yesterday's count in the host's Hollow reply (the visit
 * it records is today's) and checks the real thank-you Heartdust landed.
 * Halloween is on: the dev server runs on today's date, inside the 2026
 * window (as recipe-book.spec.ts).
 */

interface TrickDebug {
  mapId: string | null;
  open: boolean | null;
  hosts: { userId: string; lit: boolean; visited: boolean }[];
  toast: string | null;
}

interface ViewBody {
  members: { user: { id: string; username: string }; homeSlot: number | null }[];
  tiles: { q: number; r: number; homeSlot: number | null; ownerUserId: string | null }[];
}

/** The middle of `userId`'s home base: their Heart Seed. */
async function heartSeedOf(page: Page, mapId: string, userId: string) {
  const view = await api<ViewBody>(page, 'GET', `/maps/${mapId}/view`);
  expect(view.status).toBe(200);
  const home = view.body.tiles.filter((t) => t.homeSlot !== null && t.ownerUserId === userId);
  expect(home.length).toBeGreaterThan(0);
  const keys = new Set(home.map((t) => `${String(t.q)},${String(t.r)}`));
  const around = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ] as const;
  const seed = home.find((t) =>
    around.every(([dq, dr]) => keys.has(`${String(t.q + dq)},${String(t.r + dr)}`)),
  );
  return seed ?? home[0]!;
}

const heartdust = async (page: Page, mapId: string): Promise<number> => {
  const res = await api<{ items: Record<string, number> }>(page, 'GET', `/maps/${mapId}/inventory`);
  return res.body.items['heartdust'] ?? 0;
};

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('a Keeper trick-or-treats at a patch-mate’s home, once a day, and the host hears of it (#515)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const hostName = uniqueName('host');
  const guestName = uniqueName('guest');

  const host = await newPlayer(browser, hostName);
  const hostLobby = host.getByTestId('lobby');
  await hostLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await hostLobby.getByLabel('Patch name').fill('Treat Lane');
  await hostLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await hostLobby.getByTestId('lobby-invite-code').textContent()) ?? '';

  const guest = await newPlayer(browser, guestName);
  const guestLobby = guest.getByTestId('lobby');
  await guestLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await guestLobby.getByLabel('Invite code').fill(code);
  await guestLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(guestLobby.getByTestId('lobby-waiting')).toBeVisible();

  await visitPatch(hostLobby);
  await expect(hostLobby).toBeHidden();
  await host.getByTestId('lobby-open').tap();
  await hostLobby.getByRole('button', { name: /Treat Lane/ }).tap();
  await hostLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(hostLobby.getByTestId('lobby-notice')).toContainText(`${guestName} joined`);
  await visitPatch(hostLobby);
  await expect(hostLobby).toBeHidden();

  await guestLobby.getByRole('button', { name: /Treat Lane/ }).tap({ timeout: 30_000 });
  await visitPatch(guestLobby);
  await expect(guestLobby).toBeHidden();
  await expect(guest.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  // Sprout's first-visit hint (a new player's) would sit over the panel: say OK to it.
  const hintOk = guest.getByTestId('tray-hint-ok');
  await hintOk.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  if (await hintOk.isVisible()) await hintOk.tap();

  const mapId = (await hook<{ id: string }>(host, 'map'))!.id;
  const hostId = (await api<ViewBody>(host, 'GET', `/maps/${mapId}/view`)).body.members.find(
    (m) => m.user.username === hostName,
  )!.user.id;
  // The guest has heard the doors: the host's is open, unlit and not visited.
  await expect
    .poll(async () => (await hook<TrickDebug>(guest, 'trickOrTreat'))?.hosts, { timeout: 30_000 })
    .toEqual([{ userId: hostId, lit: false, visited: false }]);
  const hostDust = await heartdust(host, mapId);

  // Tap the host's Heart Seed: their home has treats tonight.
  await selectTile(guest, await heartSeedOf(guest, mapId, hostId));
  const panel = guest.getByTestId('tile-panel');
  const knock = panel.getByTestId('trick-or-treat');
  await expect(knock).toHaveText('🎃 Trick or treat!');
  await expect(panel.getByTestId('trick-line')).toHaveText(/This home has treats tonight!/);
  await knock.tap();

  // A treat, said in a toast until the door scene; the door is done for today.
  await expect(guest.getByTestId('trick-toast')).toContainText('Treat!');
  await expect(knock).toHaveText('✅ Visited today');
  await expect(knock).toBeDisabled();
  await expect(panel.getByTestId('trick-line')).toHaveText([
    /You got a treat here today!/,
    'Come back tomorrow for more.',
  ]);
  expect((await hook<TrickDebug>(guest, 'trickOrTreat'))?.hosts).toEqual([
    { userId: hostId, lit: false, visited: true },
  ]);
  // A second knock today is turned away kindly by the server, too.
  const again = await api<{ error: { code: string } }>(
    guest,
    'POST',
    `/maps/${mapId}/trick-or-treat`,
    { hostUserId: hostId },
  );
  expect(again.status).toBe(409);

  // The host's thank-you Heartdust landed with the visit.
  expect(await heartdust(host, mapId)).toBe(hostDust + 1);

  // Next morning the host's report counts their trick-or-treaters, once.
  await host.route(`**/api/v1/maps/${mapId}/hollow`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { hollow: Record<string, unknown> };
    body.hollow['trickOrTreat'] = { day: '2026-10-17', visitors: 1, heartdust: 1 };
    await route.fulfill({ response, json: body });
  });
  await host.reload();
  const report = host.getByTestId('hollow-report');
  await expect(report).toContainText('You had 1 trick-or-treater!', { timeout: 30_000 });
  await expect(report).toContainText('They left you 1 Heartdust to say thanks.');
  await report.getByTestId('hollow-report-ok').tap();
  await expect(report).toBeHidden();
  await host.reload();
  await expect(host.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect
    .poll(async () => (await hook<{ mapId: string | null }>(host, 'hollow'))?.mapId, {
      timeout: 30_000,
    })
    .toBe(mapId);
  await host.waitForTimeout(1500);
  await expect(report).toBeHidden();
});
