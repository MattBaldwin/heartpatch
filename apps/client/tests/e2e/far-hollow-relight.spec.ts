import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The Crooked House's Relight boards (#306 6f, owner decision 5): with the
 * whole house right but the Library's reading lamps (the dev route), the big
 * button opens the Hollow's own Relight card at 5×5. Giving up fades the try
 * and a new path is a new puzzle; winning (the dev answer, tapped on the real
 * board) closes the card, and the server's replay blooms the Library with its
 * scrap of the house's story. That puts the whole house right, so the attic's
 * big chest opens (owner decision 4): the cellar's moment, then the card with
 * the page, the cloak, the title and the pile, and the house is completed.
 * Checked through the dev hook (game signals, not pixels or timings).
 */

const slowExpect = expect.configure({ timeout: 30_000 });

interface Board {
  card: 'loading' | 'board' | 'reward';
  outcome: string | null;
  attempt: number | null;
  size: number | null;
  moves: number;
  picked: number | null;
}

interface HouseDebug {
  open: boolean;
  room: string | null;
  lit: boolean;
  target: { kind: string; id: string } | null;
  crooked: { id: string; kind: string; x: number; z: number }[];
  scene: {
    rooms: string[];
    attic: { shown: boolean; open: boolean; moments: number } | null;
  } | null;
  card: string | null;
  putRight: number;
  board: Board | null;
  scrap: string | null;
}

type Move = { type: 'turn'; at: number } | { type: 'slide'; at: number; to: number };

type Hooks = {
  __heartpatch?: {
    farHollowDev?: () => { openSheet(): void; place(x: number, z: number): void };
  };
};

const house = (page: Page) => hook<HouseDebug>(page, 'farHollowHouse');

/** Plays a try's answer on the real board, one tap (or a piece and its slot) a move. */
async function play(page: Page, moves: readonly Move[]): Promise<void> {
  const cells = page.getByTestId('hollowed-relight-board').locator('button');
  for (const [i, move] of moves.entries()) {
    await cells.nth(move.at).tap();
    if (move.type === 'slide' && (await house(page))?.board?.picked === move.at) {
      await cells.nth(move.to).tap();
    }
    if (i < moves.length - 1) {
      await expect.poll(async () => (await house(page))?.board?.moves).toBe(i + 1);
    }
  }
}

test('relights the Library’s board, blooms it with a story scrap, and opens the attic’s big chest (#306 6f)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('lamps'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Lamp Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Lamp Patch')!.id;
  // Every room right but the Library's board, and me in the Library.
  const dev = await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, {
    room: 'library',
    nearlyDone: true,
  });
  expect(dev.status).toBe(201);
  await visitPatch(lobby);
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().openSheet(),
  );
  await page.getByTestId('far-hollow-inside').tap();
  await slowExpect
    .poll(async () => (await house(page))?.scene?.rooms.length ?? 0)
    .toBeGreaterThan(0);
  const h = (await house(page))!;
  expect(h).toMatchObject({ open: true, room: 'library', lit: false, putRight: 12 });
  const lamps = h.crooked.find((t) => t.kind === 'relight')!;
  expect(lamps.id).toBe('reading-lamps');

  // The big button opens the board: the Hollow's card, 5×5, and the house steps aside.
  await page.evaluate(
    ({ x, z }) => (window as unknown as Hooks).__heartpatch?.farHollowDev?.().place(x, z),
    { x: lamps.x, z: lamps.z + 0.9 },
  );
  await expect.poll(async () => (await house(page))?.target?.id).toBe('reading-lamps');
  await page.getByTestId('crooked-action').tap();
  await slowExpect.poll(async () => (await house(page))?.board?.card).toBe('board');
  expect((await house(page))!.board).toMatchObject({ size: 5, attempt: 1, outcome: 'playing' });
  await expect(page.getByTestId('crooked-action')).toBeHidden();

  // Giving up fades the light; a new path is a new try (a fail reshuffles).
  await page.getByTestId('hollowed-relight-give-up').tap();
  await expect.poll(async () => (await house(page))?.board?.outcome).toBe('faded');
  await page.getByTestId('hollowed-relight-new-path').tap();
  await expect
    .poll(async () => {
      const b = (await house(page))?.board;
      return b?.card === 'board' && b.outcome === 'playing' ? b.attempt : null;
    })
    .toBe(2);

  // The server's answer to this try, played through the real board.
  const answer = await api<{ attempt: number; moves: Move[] }>(
    page,
    'POST',
    `/maps/${mapId}/dev/far-hollow/relight-answer`,
    { room: 'library', thing: 'reading-lamps' },
  );
  expect(answer.status).toBe(200);
  expect(answer.body.attempt).toBe(2);
  await play(page, answer.body.moves);

  // Relit: the card closes, the Library blooms, and its scrap of the story turns up.
  await slowExpect.poll(async () => (await house(page))?.card).toBe('bloom');
  const done = (await house(page))!;
  expect(done).toMatchObject({ board: null, lit: true, putRight: 13 });
  expect(done.scrap).toMatch(/lamp/i);
  await expect(page.getByTestId('crooked-scrap')).toContainText(done.scrap!);
  // A bloom may find a lore page too: its card comes over everything, so read it away first.
  await page
    .getByTestId('lore-close')
    .tap({ timeout: 3_000 })
    .catch(() => undefined);
  await page.getByTestId('crooked-card-ok').tap();
  await expect.poll(async () => (await house(page))?.card).toBeNull();
  const saved = await api<{ house: { rooms: { id: string; bloomed: boolean }[] } }>(
    page,
    'GET',
    `/maps/${mapId}/far-hollow`,
  );
  expect(saved.body.house.rooms.find((r) => r.id === 'library')?.bloomed).toBe(true);

  // Up to the attic (the dev route, as the dollhouse map walks to a lit room), and back inside.
  await page.getByTestId('crooked-back').tap();
  await expect.poll(async () => (await house(page))?.open).toBe(false);
  expect((await api(page, 'POST', `/maps/${mapId}/dev/far-hollow`, { room: 'attic' })).status).toBe(
    201,
  );
  await page.getByTestId('far-hollow-inside').tap();
  await slowExpect.poll(async () => (await house(page))?.scene?.attic?.shown).toBe(true);
  expect((await house(page))!).toMatchObject({ room: 'attic', lit: true });
  expect((await house(page))!.scene!.attic).toMatchObject({ open: false, moments: 0 });
  // The big chest stands north of the middle: walk up to it.
  await page.evaluate(
    ({ x, z }) => (window as unknown as Hooks).__heartpatch?.farHollowDev?.().place(x, z),
    { x: 0, z: 5.6 - 0.6 },
  );
  await expect.poll(async () => (await house(page))?.target?.kind).toBe('attic');
  await expect(page.getByTestId('crooked-bubble')).toHaveText(
    'The story page is ready to read! 📜',
  );
  await page.getByTestId('crooked-action').tap();
  // The cellar's moment, then the card: the page, the cloak, the title and the pile.
  await slowExpect.poll(async () => (await house(page))?.card).toBe('attic');
  expect((await house(page))!.scene!.attic).toMatchObject({ open: true, moments: 1 });
  const lines = page.getByTestId('crooked-attic-lines');
  await slowExpect(lines).toBeVisible();
  await expect(lines).toContainText('A Lantern in Every Room');
  await expect(lines).toContainText(/Lantern Keeper.s Cloak/);
  await expect(lines).toContainText('Your title: Lantern Keeper');
  await expect(lines).toContainText('Glimmer');
  await page
    .getByTestId('lore-close')
    .tap({ timeout: 3_000 })
    .catch(() => undefined);
  await page.getByTestId('crooked-card-ok').tap();
  await expect.poll(async () => (await house(page))?.card).toBeNull();
  const completed = await api<{ completedAt: string | null; house: { chestsOpened: string[] } }>(
    page,
    'GET',
    `/maps/${mapId}/far-hollow`,
  );
  expect(completed.body.completedAt).not.toBeNull();
  expect(completed.body.house.chestsOpened).toContain('attic');
  expect(errors).toEqual([]);
});
