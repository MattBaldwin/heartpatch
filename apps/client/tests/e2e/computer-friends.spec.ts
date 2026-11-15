import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Computer friends (#386b): the owner's On/Off switch in patch settings, the
 * Computer friend badge on member rows and in Who's here, and the hello card
 * when mates move in. The server half (who moves in, 386a/386c) is stood in
 * by route stubs, so this spec runs whether or not the e2e server opens
 * `HP_COMPUTER_MATES`: the switch route, the detail's `computerMates` and the
 * mates' seats are stubbed.
 */

interface Member {
  user: { id: string; username: string };
  role: string;
  homeSlot: number | null;
  computer?: { personaId: string };
}

const MATES = ['Bramble', 'Marigold', 'Pocket'];
const mateId = (i: number) => `00000000-0000-4000-8000-00000000038${String(i)}`;

/** The three mates as the server seats them, cloned from a real member's shape. */
function withMates(members: Member[]): Member[] {
  const base = members[0];
  if (!base) return members;
  return [
    ...members,
    ...MATES.map((name, i) => ({
      ...base,
      user: { ...base.user, id: mateId(i), username: name },
      role: 'member',
      homeSlot: members.length + i,
      computer: { personaId: name.toLowerCase() },
    })),
  ];
}

/** Stubs the switch and every reply that carries the roster; `state.on` is the switch. */
async function stubComputerMates(page: Page, state: { on: boolean; mapId: string }): Promise<void> {
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/computer-mates$/, async (route) => {
    const body = route.request().postDataJSON() as { enabled: boolean };
    state.on = body.enabled;
    await route.fulfill({ json: { enabled: state.on, changeAt: null } });
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    state.mapId = /[0-9a-f-]{36}$/.exec(route.request().url())?.[0] ?? state.mapId;
    const response = await route.fetch();
    const json = (await response.json()) as {
      map: { members: Member[] } & Record<string, unknown>;
    };
    json.map['computerMates'] = { enabled: state.on, changeAt: null };
    if (state.on) json.map.members = withMates(json.map.members);
    return route.fulfill({ response, json });
  });
  // A new patch's first screen is the create reply's detail.
  await page.route(/\/api\/v1\/maps$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const json = (await response.json()) as { map: { id: string } & Record<string, unknown> };
    state.mapId = json.map.id;
    json.map['computerMates'] = { enabled: state.on, changeAt: null };
    return route.fulfill({ response, json });
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/view$/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { members: Member[] };
    if (state.on) json.members = withMates(json.members);
    return route.fulfill({ response, json });
  });
}

test('the owner switches Computer friends on, and three badged mates move in (#386b)', async ({
  browser,
}) => {
  test.setTimeout(120_000); // one signup, then the patch opens; CI renders in software
  const owner = uniqueName('cf');
  const page = await newPlayer(browser, owner);
  const state = { on: false, mapId: '' };
  await stubComputerMates(page, state);
  const lobby = page.getByTestId('lobby');

  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Mia Meadow');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByRole('heading', { name: 'Mia Meadow' })).toBeVisible();

  // Off by default: the owner's switch reads Off in words, with the honest line.
  const section = lobby.getByTestId('lobby-computer');
  const toggle = section.getByTestId('lobby-computer-toggle');
  await expect(toggle).toHaveText('Off');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(section).toContainText("They're run by the game, not real people.");

  // On: the server's reply redraws the screen, and three badged mates live here.
  await toggle.tap();
  await expect(lobby.getByTestId('lobby-notice')).toHaveText('Computer friends: On.');
  await expect(toggle).toHaveText('On');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(section.getByTestId('lobby-computer-note')).toContainText(
    '3 computer friends live here.',
  );
  const members = lobby.getByTestId('lobby-members');
  const mateRows = members.locator('[data-computer="true"]');
  await expect(mateRows).toHaveCount(3);
  for (const row of await mateRows.all()) {
    await expect(row.getByTestId('computer-badge')).toHaveText('Computer friend');
    await expect(row.getByTestId('computer-avatar')).toBeVisible();
    // No password to reset and nothing to remove: the switch sends them home.
    await expect(row.getByRole('button')).toHaveCount(0);
  }
  // The real kid (the owner) keeps their round map icon and no badge.
  const kid = members.getByRole('listitem').filter({ hasText: `${owner} (you)` });
  await expect(kid.locator('.slot-icon')).toHaveCount(1);
  await expect(kid.getByTestId('computer-badge')).toHaveCount(0);

  // On the patch: Sprout's first-visit tray hint comes first, and the hello
  // waits behind it (one card at a time). Then one card says hello to the
  // mates who moved in.
  await visitPatch(lobby);
  const hello = page.getByTestId('computer-hello');
  const hintOk = page.getByTestId('tray-hint-ok');
  await expect(hintOk).toBeVisible({ timeout: 15_000 });
  await expect(hello).toBeHidden();
  await hintOk.tap();
  await expect(hello).toBeVisible({ timeout: 15_000 });
  await expect(hello.getByRole('heading')).toHaveText(
    'Bramble, Marigold and Pocket moved in next door! 🏡',
  );
  await expect(hello).toContainText("They're run by the game.");
  expect((await hook<{ hello: string | null }>(page, 'computerMates'))?.hello).toContain('Bramble');
  await hello.getByTestId('computer-hello-ok').tap();
  await expect(hello).toBeHidden();

  // Who's here: the mates sit under their own label, always here, badged, with
  // no "Battle me?" until the server takes an ask to a mate (#386e).
  await page.getByTestId('friendly-open').tap();
  const mates = page.getByTestId('friendly-computer-list');
  await expect(mates.getByRole('listitem')).toHaveCount(3);
  await expect(mates.getByTestId('computer-badge')).toHaveCount(3);
  await expect(mates.getByRole('button')).toHaveCount(0);
  await expect(page.getByText('Battles with Computer friends are coming soon!')).toBeVisible();
  await page.context().close();
});
