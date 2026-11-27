import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
import { api, hook, liveMapId } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { grantSquishy, twoTraders, visitPost } from './trading.js';

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
    const json = (await response.json()) as {
      members: Member[];
      tiles: { homeSlot: number | null; ownerUserId: string | null }[];
    };
    if (state.on) {
      json.members = withMates(json.members);
      // Each mate holds its home ring, as the server seats them, so its flag flies.
      const slots = new Map(json.members.map((m) => [m.homeSlot, m.user.id] as const));
      for (const t of json.tiles) {
        const owner = t.homeSlot === null ? undefined : slots.get(t.homeSlot);
        if (owner && t.ownerUserId === null) t.ownerUserId = owner;
      }
    }
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
  await lobby.getByLabel('Patch name').fill("Mia's Meadow");
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByRole('heading', { name: "Mia's Meadow" })).toBeVisible();

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
    '3 Computer friends live here.',
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

  // On the map, a mate's home flag wears the badge beside its name (mockup 2c).
  const brambleFlag = page.getByTestId('home-flag').filter({ hasText: 'Bramble' });
  await expect(brambleFlag.getByTestId('computer-badge')).toHaveText('Computer friend');

  // Who's here: the mates sit under their own label, always here, badged, each
  // with a real "Battle me?" (#386f; the server answers for a mate at once).
  await page.getByTestId('friendly-open').tap();
  const mates = page.getByTestId('friendly-computer-list');
  await expect(mates.getByRole('listitem')).toHaveCount(3);
  await expect(mates.getByTestId('computer-badge')).toHaveCount(3);
  await expect(mates.getByRole('button', { name: 'Battle me?' })).toHaveCount(3);
  // Only mates here: the hint doesn't say nobody's here above a list of them.
  await expect(
    page.getByText('No other Keepers right now, but your Computer friends are up for a battle!'),
  ).toBeVisible();
  await expect(mates.getByText('Always up for a friendly!')).toHaveCount(3);
  // Layout (render check): at 393 and 320 pt the badge sits under the name,
  // clear of "Battle me?", which stays on one line.
  for (const width of [393, 320]) {
    await page.setViewportSize({ width, height: 852 });
    for (const row of await mates.getByRole('listitem').all()) {
      const pill = await row.getByTestId('computer-badge').boundingBox();
      const name = await row.locator('.friendly-name').boundingBox();
      const btn = await row.getByTestId('friendly-battle-mate').boundingBox();
      if (!pill || !name || !btn) throw new Error('row parts missing');
      const apart = pill.x + pill.width <= btn.x + 0.5 || btn.y >= pill.y + pill.height - 0.5;
      expect(apart, `badge clear of the button at ${String(width)}`).toBe(true);
      expect(pill.y, 'badge under the name').toBeGreaterThanOrEqual(name.y + name.height - 1);
      expect(btn.height, `one-line button at ${String(width)}`).toBeLessThan(60);
      const clipped = await row
        .getByTestId('computer-badge')
        .evaluate((n) => n.scrollWidth > n.clientWidth + 1);
      expect(clipped, 'badge words not clipped').toBe(false);
    }
  }
  await expect(page.getByText('Battles with Computer friends are coming soon!')).toHaveCount(0);
  // The card says who it is, with the badge and no level-gap line.
  await mates.getByTestId('friendly-battle-mate').first().tap();
  const card = page.getByTestId('friendly');
  await expect(card.getByRole('heading')).toContainText('A friendly battle with');
  await expect(card.getByTestId('friendly-mate-line').getByTestId('computer-badge')).toBeVisible();
  // A mate answers inside the ask's own reply. A "Not now" reply goes straight
  // to the kind "can't battle right now" screen, never to a stuck "Asking…".
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/challenges$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON() as { toUserId: string };
    const now = Date.now();
    return route.fulfill({
      json: {
        challenge: {
          id: '00000000-0000-4000-8000-000000000391',
          kind: 'friendly',
          status: 'declined',
          fromUserId: '00000000-0000-4000-8000-000000000392',
          toUserId: body.toUserId,
          fromTeamLevel: 1,
          toTeamLevel: 1,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
          battleId: null,
        },
      },
    });
  });
  await card.getByTestId('friendly-ask-send').tap();
  await expect(card.getByTestId('friendly-okay')).toBeVisible();
  await expect(card.getByTestId('friendly-never-mind')).toHaveCount(0);
  // The declined screen badges the mate, names a nap (no timer), and the
  // title keeps clear of the ✕ at 393 and 320 pt.
  await expect(card.getByTestId('computer-avatar')).toBeVisible();
  await expect(card.getByTestId('computer-badge')).toHaveText('Computer friend');
  await expect(card).toContainText('is having a little nap!');
  await expect(card).not.toContainText('minutes');
  for (const width of [393, 320]) {
    await page.setViewportSize({ width, height: 852 });
    // The title's box spans the sheet (its padding holds the ✕'s room), so
    // measure the words themselves.
    const words = await card.locator('.friendly-title').evaluate((n) => {
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      return { right: r.right, top: r.top, bottom: r.bottom };
    });
    const close = await card.locator('.friendly-close').boundingBox();
    if (!close) throw new Error('close missing');
    const apart = words.right <= close.x || words.bottom <= close.y;
    expect(apart, `title clear of the close button at ${String(width)}`).toBe(true);
  }
  await page.context().close();
});

/**
 * A mate's "yes" arrives inside the ask's own reply (#386e): the asker opens
 * the battle, and only once. The server's reply and the battle read are stood
 * in by stubs; the battle body is a real dev fight the player started.
 */
test('a mate that says yes opens the battle exactly once (#386f)', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('cf'));
  const state = { on: true, mapId: '' };
  await stubComputerMates(page, state);
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Yes Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.getByTestId('map-hud')).toContainText('Yes Patch');
  const hintOk = page.getByTestId('tray-hint-ok');
  await expect(hintOk).toBeVisible({ timeout: 15_000 });
  await hintOk.tap();
  const hello = page.getByTestId('computer-hello');
  await expect(hello).toBeVisible({ timeout: 15_000 });
  await hello.getByTestId('computer-hello-ok').tap();

  // A real fight to borrow the battle body from (the starter is home already).
  const mapId = await liveMapId(page);
  const made = await api<{ battle: { id: string } & Record<string, unknown> }>(
    page,
    'POST',
    `/maps/${mapId}/dev/battles`,
    {},
  );
  expect(made.status).toBeLessThan(300);
  const battleId = made.body.battle.id;

  let reads = 0;
  await page.route(new RegExp(`/api/v1/battles/${battleId}$`), async (route) => {
    reads += 1;
    return route.fulfill({ json: made.body });
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/challenges$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON() as { toUserId: string };
    const now = Date.now();
    return route.fulfill({
      json: {
        challenge: {
          id: '00000000-0000-4000-8000-000000000393',
          kind: 'friendly',
          status: 'accepted',
          fromUserId: '00000000-0000-4000-8000-000000000392',
          toUserId: body.toUserId,
          fromTeamLevel: 1,
          toTeamLevel: 1,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
          battleId,
        },
      },
    });
  });
  await page.getByTestId('friendly-open').tap();
  await page.getByTestId('friendly-battle-mate').first().tap();
  await page.getByTestId('friendly-ask-send').tap();
  await expect(page.getByTestId('battle-hud')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => hook<{ id: string }>(page, 'battle').then((b) => b?.id)).toBe(battleId);
  // Let any second opener (a live event, a retry) show itself before counting.
  await page.waitForTimeout(1_500);
  expect(reads, 'the battle is read once').toBe(1);
  await page.context().close();
});

/**
 * Render check (#386f): a mate's name, key avatar and pill stay inside their
 * shelf column on a phone. The server's seat for Sam is stood in by a stub
 * that marks Sam a mate on Lee's screen; the shelf itself is real.
 */
test('a mate shelf header stays inside its column at 393 and 320 pt (#386f)', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const { lee, samName, mapId } = await twoTraders(browser, 'Mate Shelf Patch');
  await grantSquishy(lee, mapId, 'emberbun', 9);
  await lee.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/view$/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { members: Member[] };
    for (const m of json.members) {
      if (m.user.username === samName) m.computer = { personaId: 'bramble' };
    }
    return route.fulfill({ response, json });
  });
  await lee.reload();
  await expect(lee.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await visitPost(lee);
  const post = lee.getByTestId('post');
  const theirs = post.locator('[data-side="theirs"]');
  await expect(theirs.getByTestId('computer-badge')).toBeVisible();
  for (const width of [393, 320]) {
    await lee.setViewportSize({ width, height: 852 });
    const edges = await theirs.evaluate((col) => {
      const head = col.querySelector<HTMLElement>('.post-col-head')!;
      return {
        head: head.getBoundingClientRect().right,
        col: col.getBoundingClientRect().right,
      };
    });
    expect(edges.head, `header inside its column at ${String(width)}`).toBeLessThanOrEqual(
      edges.col + 0.5,
    );
  }
  await lee.context().close();
});
