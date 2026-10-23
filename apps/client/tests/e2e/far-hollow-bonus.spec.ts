import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The Crooked House's bonus rooms (#306 6e): the Parlour's cold fireplace
 * sleeps behind Fire. "Who can help?" lists my battle team, the Fire friend
 * first; picking it plays its moment and the server opens the door. Through
 * it, the Inglenook's chest opens once: its loot's card (and, now and then,
 * a rare friend's, whose battle is waiting), saved at once. Checked through
 * the dev hook (game signals, not pixels).
 */

const slowExpect = expect.configure({ timeout: 30_000 });

interface HouseDebug {
  open: boolean;
  room: string | null;
  target: { kind: string; id: string; state?: string } | null;
  action: string | null;
  card: string | null;
  busy: boolean;
  scene: { rooms: string[] } | null;
  picker: { door: string; helpers: { id: string; helps: boolean }[] | null } | null;
  powering: boolean;
  bonus: {
    chests: { room: string; open: boolean; x: number; z: number }[];
    friend: string | null;
  } | null;
}

interface BattleDebug {
  phase: string;
}

type Hooks = {
  __heartpatch?: { farHollowDev?: () => { openSheet(): void; place(x: number, z: number): void } };
};

const house = (page: Page) => hook<HouseDebug>(page, 'farHollowHouse');
const place = (page: Page, x: number, z: number) =>
  page.evaluate(
    ({ x, z }) => (window as unknown as Hooks).__heartpatch?.farHollowDev?.().place(x, z),
    { x, z },
  );

test('a Fire friend lights the cold fireplace and the Inglenook’s chest opens (#306 6e)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('nook'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Bonus Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Bonus Patch')!.id;
  await visitPatch(lobby);
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // A Fire friend, stronger than the starter, so it's on the team the server picks.
  const granted = await api<{ squishy: { id: string } }>(
    page,
    'POST',
    `/maps/${mapId}/dev/squishies`,
    { speciesId: 'candlekit', level: 12 },
  );
  expect(granted.status).toBe(201);
  const fireFriend = granted.body.squishy.id;
  // In the Parlour, by its cold fireplace (every key turned; power doors stay asleep).
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'parlour' })).status,
  ).toBe(201);

  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().openSheet(),
  );
  await page.getByTestId('far-hollow-inside').tap();
  await slowExpect
    .poll(async () => (await house(page))?.scene?.rooms.length ?? 0)
    .toBeGreaterThan(0);
  expect((await house(page))?.room).toBe('parlour');

  // The sleeping door: its button asks who can help.
  await place(page, -7.9, 0.2);
  await expect
    .poll(async () => (await house(page))?.target)
    .toMatchObject({ kind: 'door', id: 'inglenook-door', state: 'sleeping' });
  await expect(page.getByTestId('crooked-action')).toHaveText('Who can help? 🔥');
  await page.getByTestId('crooked-action').tap();

  // The picker: my team, the Fire friend first and the only one who can help.
  const picker = page.getByTestId('crooked-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('heading')).toHaveText('Who can help? 🔥');
  await expect
    .poll(async () => (await house(page))?.picker?.helpers?.length ?? 0)
    .toBeGreaterThan(1);
  const helpers = (await house(page))!.picker!.helpers!;
  expect(helpers[0]).toEqual({ id: fireFriend, helps: true });
  expect(helpers.slice(1).every((x) => !x.helps)).toBe(true);
  // Not now closes it; the button opens it again.
  await page.getByTestId('crooked-picker-close').tap();
  await expect(picker).toBeHidden();
  await page.getByTestId('crooked-action').tap();
  await page.getByTestId(`crooked-helper-${fireFriend}`).tap();

  // Its moment plays, then the door wakes: open, and saved on the server.
  await expect(picker).toBeHidden();
  await slowExpect.poll(async () => (await house(page))?.powering).toBe(false);
  // The door is open: nothing left to do at it (its words are unit-tested; the bubble fades).
  await expect.poll(async () => (await house(page))?.target?.id ?? null).not.toBe('inglenook-door');
  const woke = await api<{ house: { bonusOpen: string[] } }>(
    page,
    'GET',
    `/maps/${mapId}/far-hollow`,
  );
  expect(woke.body.house.bonusOpen).toContain('inglenook-door');

  // West through the open fireplace into the Inglenook (the server moves me).
  await place(page, -7.6, 0.2);
  const stick = (await page.getByTestId('crooked-stick').boundingBox())!;
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 45, cy, { steps: 3 });
  await slowExpect.poll(async () => (await house(page))?.room).toBe('inglenook');
  await page.mouse.up();

  // Whether this chest holds a friend is the season's secret (rule 6): when
  // the server's roll gave none, its reply gets one, whose wild battle the
  // dev route starts, so the friend's path always plays.
  await page.route('**/api/v1/maps/*/far-hollow/chest', async (route) => {
    const real = await route.fetch();
    const body = (await real.json()) as { friend: { speciesId: string; battleId: string } | null };
    if (!body.friend) {
      const started = await page.request.post(`/api/v1/maps/${mapId}/dev/battles`, {
        headers: { 'x-requested-with': 'heartpatch' },
        data: { opponent: { speciesId: 'glowboo', level: 6 } },
      });
      const { battle } = (await started.json()) as { battle: { id: string } };
      body.friend = { speciesId: 'glowboo', battleId: battle.id };
    }
    await route.fulfill({ response: real, json: body });
  });

  // The chest: shut, then opened once, its card and the server agreeing.
  const chest = (await house(page))!.bonus!.chests.find((c) => c.room === 'inglenook')!;
  expect(chest.open).toBe(false);
  await place(page, chest.x, chest.z - 1.05);
  await expect
    .poll(async () => (await house(page))?.target)
    .toMatchObject({ kind: 'chest', id: 'inglenook' });
  await expect(page.getByTestId('crooked-action')).toHaveText('Open the chest 🎁');
  await page.getByTestId('crooked-action').tap();
  await expect(page.getByTestId('crooked-card')).toHaveAttribute('data-kind', 'chest');
  await expect(page.getByTestId('crooked-card').getByRole('heading')).toHaveText('Treasure! 🎁');
  expect((await house(page))!.bonus!.chests.find((c) => c.room === 'inglenook')?.open).toBe(true);
  const opened = await api<{ house: { chestsOpened: string[] } }>(
    page,
    'GET',
    `/maps/${mapId}/far-hollow`,
  );
  expect(opened.body.house.chestsOpened).toContain('inglenook');
  await page.getByTestId('crooked-card-ok').tap();

  // The rare friend: its card, then "Say hello!" opens its battle (the house steps aside).
  await expect(page.getByTestId('crooked-card')).toHaveAttribute('data-kind', 'friend');
  await expect(page.getByTestId('crooked-card').getByRole('heading')).toHaveText(
    'Someone’s in the chest! 👀',
  );
  expect((await house(page))?.bonus?.friend).toBeTruthy();
  await page.getByTestId('crooked-card-ok').tap();
  await slowExpect.poll(async () => (await house(page))?.open).toBe(false);
  await slowExpect.poll(async () => (await hook<BattleDebug>(page, 'battle'))?.phase).toBe('turn');

  // Scoot away from it: closing the battle comes back into the Inglenook, not the map.
  await page.getByTestId('battle-run').tap();
  await page.getByTestId('battle-run-confirm').tap();
  await page.getByTestId('battle-done').tap({ timeout: 60_000 });
  await slowExpect.poll(async () => (await house(page))?.open).toBe(true);
  expect((await house(page))?.room).toBe('inglenook');
  expect(errors).toEqual([]);
});
