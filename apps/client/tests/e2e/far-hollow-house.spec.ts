import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The Crooked House screen (#306 6c): arrived at the far Hollow (the dev
 * route), "Go inside" on its sheet opens the house in the lit Front Hall.
 * The north door is locked and its bubble names the key, never where it is.
 * The joystick walks me west through the open doorway into the dark Parlour
 * (the server moves me), where the lantern's dark closes in and the big
 * button names a crooked thing; putting it right is saved at once. Tiptoe
 * and the dollhouse map are buttons; Back leaves for the sheet. Checked
 * through the dev hook (game signals, not pixels).
 */

const slowExpect = expect.configure({ timeout: 30_000 });

interface HouseDebug {
  open: boolean;
  room: string | null;
  map: boolean;
  lit: boolean;
  dark: boolean;
  tiptoe: boolean;
  target: { kind: string; id: string; state?: string } | null;
  action: string | null;
  bubble: string | null;
  busy: boolean;
  crooked: { id: string; kind: string; x: number; z: number }[];
  scene: { rooms: string[] } | null;
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

test('goes inside the Crooked House, tries a locked door, walks into a dark room and puts a thing right (#306 6c)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('lantern'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Crooked Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Crooked Patch')!.id;
  expect((await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, {})).status).toBe(201);
  await visitPatch(lobby);
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().openSheet(),
  );
  await page.getByTestId('far-hollow-inside').tap();
  await slowExpect
    .poll(async () => (await house(page))?.scene?.rooms.length ?? 0)
    .toBeGreaterThan(0);
  let h = (await house(page))!;
  expect(h).toMatchObject({ open: true, room: 'front-hall', lit: true, dark: false, map: false });
  await expect(page.getByTestId('crooked-keys')).toHaveText('🗝️ 0 of 6');
  await expect(page.getByTestId('crooked-stick')).toBeVisible();
  await expect(page.getByTestId('crooked-tiptoe')).toBeVisible();

  // The north door: locked, and it says which key.
  await place(page, 0.2, 1.7);
  await expect.poll(async () => (await house(page))?.target?.id).toBe('north-door');
  await page.getByTestId('crooked-action').tap();
  await expect(page.getByTestId('crooked-bubble')).toHaveText(
    'Locked tight! The Brass Key is somewhere in this house…',
  );

  // West through the open doorway on the joystick: the server moves me into the Parlour.
  await place(page, -1.2, 0.3);
  const stick = (await page.getByTestId('crooked-stick').boundingBox())!;
  const cx = stick.x + stick.width / 2;
  const cy = stick.y + stick.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 45, cy, { steps: 3 });
  await slowExpect.poll(async () => (await house(page))?.room).toBe('parlour');
  await page.mouse.up();
  h = (await house(page))!;
  expect(h.lit).toBe(false);
  await expect.poll(async () => (await house(page))?.dark).toBe(true);

  // A crooked thing: the button names it, and a tap puts it right (saved on the server).
  const thing = h.crooked.find((t) => t.kind !== 'lift' && t.kind !== 'relight')!;
  await place(page, thing.x, thing.z - 0.9);
  await expect.poll(async () => (await house(page))?.target?.id).toBe(thing.id);
  await expect(page.getByTestId('crooked-action')).toBeVisible();
  await page.getByTestId('crooked-action').tap();
  await expect
    .poll(async () => (await house(page))?.crooked.some((t) => t.id === thing.id))
    .toBe(false);
  const saved = await api<{ house: { rooms: { id: string; fixed: string[] }[] } }>(
    page,
    'GET',
    `/maps/${mapId}/far-hollow`,
  );
  expect(saved.body.house.rooms.find((r) => r.id === 'parlour')?.fixed).toContain(thing.id);
  await page
    .getByTestId('crooked-card-ok')
    .tap({ timeout: 2_000 })
    .catch(() => undefined);

  // Tiptoe is a button: tap it on, tap it off.
  await page.getByTestId('crooked-tiptoe').tap();
  await expect.poll(async () => (await house(page))?.tiptoe).toBe(true);
  await page.getByTestId('crooked-tiptoe').tap();
  await expect.poll(async () => (await house(page))?.tiptoe).toBe(false);

  // The dollhouse map shows the whole floor; Back closes it, then leaves for the sheet.
  await page.getByTestId('crooked-map').tap();
  await expect.poll(async () => (await house(page))?.map).toBe(true);
  expect((await house(page))!.scene!.rooms.length).toBeGreaterThan(4);
  await page.getByTestId('crooked-back').tap();
  await expect.poll(async () => (await house(page))?.map).toBe(false);
  await page.getByTestId('crooked-back').tap();
  await expect.poll(async () => (await house(page))?.open).toBe(false);
  await slowExpect(page.getByTestId('far-hollow-sheet')).toBeVisible();
  expect(errors).toEqual([]);
});
