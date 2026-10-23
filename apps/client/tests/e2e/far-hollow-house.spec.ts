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
  scene: { rooms: string[]; echoes: number } | null;
  card: string | null;
  echoes: { loop: string; room: string; position: number; shown: number; mark: string }[];
  echoHint: { door: string; room: string; plain: string | null; soft: string | null } | null;
  peek: { phase: string; calm: boolean; shook: boolean; friend: boolean } | null;
  caught: { echo: string; backTo: string } | null;
}

type Hooks = {
  __heartpatch?: {
    farHollowDev?: () => {
      openSheet(): void;
      place(x: number, z: number): void;
      step(doorId: string): void;
    };
  };
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

/**
 * Waits until the stair echo's gap to the Stair Hall's middle is in
 * (`from`, `to`) and closing (or opening), compared with the last poll however
 * far apart a slow phone's polls fall. Two laps of the echo at most.
 */
async function echoWindow(
  page: Page,
  from: number,
  to: number,
  closing: boolean,
  heard: (h: HouseDebug) => boolean,
): Promise<void> {
  let last = closing ? 9 : -1;
  await expect
    .poll(
      async () => {
        // One read: the gap and what's heard at the door from the same moment.
        const h = await house(page);
        const e = h?.echoes.find((x) => x.loop === 'stair-echo');
        if (!h || !e) return false;
        const gap = Math.min(e.position, 2 - e.position);
        const ok = (closing ? gap < last : gap > last) && gap > from && gap < to && heard(h);
        last = gap;
        return ok;
      },
      { intervals: [50], timeout: 60_000 },
    )
    .toBe(true);
}

/**
 * Through the open north door (the dev hook, as walking into the doorway
 * does: a software-rendered iPad walks too slowly to time it; 6c's test
 * walks a doorway), until the server lets me in or an echo catches me
 * (the peekaboo plays). True if caught.
 */
async function stepNorth(page: Page): Promise<boolean> {
  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().step('north-door'),
  );
  await expect
    .poll(async () => {
      const h = await house(page);
      return h?.peek != null || h?.room === 'stair-hall';
    })
    .toBe(true);
  return (await house(page))?.peek != null;
}

/** Back from the Stair Hall to the lit Front Hall (straight there, no echo in a lit room). */
async function stepBack(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().step('north-door'),
  );
  await expect.poll(async () => (await house(page))?.room).toBe('front-hall');
}

/**
 * At the north door as the stair echo drifts in towards the Stair Hall's
 * middle: it hears me, and stepping in it catches me. The server decides on
 * its own clock; two busy software-rendered phones can slow a reply past
 * the moment, so a miss steps back out and waits for the next lap.
 */
async function getCaught(page: Page): Promise<void> {
  for (let tries = 0; ; tries++) {
    await place(page, 0.2, 1.6);
    await echoWindow(
      page,
      0.12,
      0.29,
      true,
      (h) =>
        h.echoHint?.room === 'stair-hall' &&
        h.echoHint.plain === 'stair-echo' &&
        (h.bubble ?? '').includes('an echo is close'),
    );
    if (await stepNorth(page)) return;
    expect(tries).toBeLessThan(3);
    await stepBack(page);
  }
}

/**
 * Tiptoeing in while the stair echo is near but drifting off: it would
 * notice me walking in, not creeping. A catch (a reply slowed past the
 * moment) reads its card and tries again on the next lap.
 */
async function creepPast(page: Page): Promise<void> {
  for (let tries = 0; ; tries++) {
    await place(page, 0.2, 1.6);
    await echoWindow(
      page,
      0.16,
      0.26,
      false,
      (h) => h.echoHint?.plain === 'stair-echo' && h.echoHint.soft === null,
    );
    if (!(await stepNorth(page))) return;
    expect(tries).toBeLessThan(3);
    await slowExpect.poll(async () => (await house(page))?.card).toBe('caught');
    await page.getByTestId('crooked-card-ok').tap();
    await expect.poll(async () => (await house(page))?.card ?? null).toBeNull();
  }
}

/**
 * The echoes (#306 6d): with every key turned (the dev route), the stair
 * echo drifts between the Stair Hall and the Dining Room. Waiting at the
 * open north door, I hear it when it's close; stepping in right then, the
 * server catches me: the peekaboo plays (dark, eyes, the boo with its shake)
 * and I'm back in the lit Front Hall with a friendly card, nothing lost.
 * Tiptoe gets me past it when it's near but not right there. Reduced motion
 * plays the calm peekaboo, with no shake. Game signals, not pixels.
 */
test('an echo catches me with a peekaboo and sends me back to the light; tiptoe creeps past it (#306 6d)', async ({
  browser,
}) => {
  // Up to a few laps of the echo for each catch on a slow software-rendered iPad.
  test.setTimeout(480_000);
  const page = await newPlayer(browser, uniqueName('echo'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Echo Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Echo Patch')!.id;
  const jump = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'front-hall' });
  expect(jump.status).toBe(201);
  await visitPatch(lobby);
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().openSheet(),
  );
  await page.getByTestId('far-hollow-inside').tap();
  await slowExpect
    .poll(async () => (await house(page))?.scene?.rooms.length ?? 0)
    .toBeGreaterThan(0);
  expect((await house(page))!).toMatchObject({ room: 'front-hall', lit: true });

  // The stair echo drifts in the Stair Hall next door: drawn, or (under the top HUD) its eyes peek in.
  await expect
    .poll(async () => {
      const h = await house(page);
      const eyes = h?.echoes.some((e) => e.loop === 'stair-echo' && e.mark !== 'off') ?? false;
      return (h?.scene?.echoes ?? 0) > 0 || eyes;
    })
    .toBe(true);
  await place(page, 0.2, 1.6);
  await expect.poll(async () => (await house(page))?.echoHint?.room).toBe('stair-hall');

  // Drifting in towards the Stair Hall's middle: it hears me, and stepping in it catches me.
  await getCaught(page);
  await expect.poll(async () => (await house(page))?.caught?.echo).toBe('stair-echo');
  await expect.poll(async () => (await house(page))?.peek?.shook).toBe(true);
  expect((await house(page))!.peek!.calm).toBe(false);
  await slowExpect.poll(async () => (await house(page))?.card).toBe('caught');
  let h = (await house(page))!;
  expect(h).toMatchObject({ room: 'front-hall', lit: true, caught: { backTo: 'front-hall' } });
  expect(h.peek?.friend).toBe(true);
  await expect(page.getByTestId('crooked-card')).toContainText('Back to the light');
  await expect(page.getByTestId('crooked-keys')).toHaveText('🗝️ 6 of 6');
  await page.getByTestId('crooked-card-ok').tap();
  await expect.poll(async () => (await house(page))?.card ?? null).toBeNull();
  expect((await house(page))!.peek).toBeNull();

  // Tiptoe: near but drifting off, it would still notice me walking in, not creeping.
  await page.getByTestId('crooked-tiptoe').tap();
  await expect.poll(async () => (await house(page))?.tiptoe).toBe(true);
  await creepPast(page);
  await expect.poll(async () => (await house(page))?.room).toBe('stair-hall');
  expect((await house(page))!.card).toBeNull();
  await page.getByTestId('crooked-tiptoe').tap();
  await expect.poll(async () => (await house(page))?.tiptoe).toBe(false);

  // Reduced motion: from the Front Hall again (Back, the dev route, Go inside), caught calmly.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('crooked-back').tap();
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'front-hall' })).status,
  ).toBe(201);
  await expect.poll(async () => (await house(page))?.open).toBe(false);
  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().openSheet(),
  );
  await page.getByTestId('far-hollow-inside').tap();
  await expect.poll(async () => (await house(page))?.room).toBe('front-hall');
  await getCaught(page);
  await expect.poll(async () => (await house(page))?.peek?.calm).toBe(true);
  await slowExpect.poll(async () => (await house(page))?.card).toBe('caught');
  h = (await house(page))!;
  expect(h.peek).toMatchObject({ calm: true, shook: false, friend: true });
  expect(h.room).toBe('front-hall');
  await page.getByTestId('crooked-card-ok').tap();
  await expect.poll(async () => (await house(page))?.card ?? null).toBeNull();
  expect(errors).toEqual([]);
});
