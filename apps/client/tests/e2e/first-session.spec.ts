import { GAME_DATA } from '@heartpatch/shared';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { holdCinematic, newPlayer, pickKeeper, signUp, uniqueName, visitPatch } from './players.js';

/**
 * A new player's whole first session, end to end (#28's playtest smoke):
 * sign up, pick a Keeper, skip the story with a long press, Sprout's tutorial
 * (the dev route jumps over its gameplay steps, which tutorial.spec.ts plays),
 * make a patch, let a friend in, befriend a wild squishy and claim a tile.
 * Each system has its own spec; this one checks they join up. Asserts on the
 * dev hook, test ids and the API, never on pixels.
 */

/**
 * Every check waits up to 30 s: the page's main thread renders in software in
 * CI, so a single dev-hook read can take seconds while a scene is drawing.
 */
const expect = baseExpect.configure({ timeout: 30_000 });

/** Strong enough to beat the guardians next to home, and nothing left to grow into. */
const STRONG_LEVEL = 40;
const STRONG = GAME_DATA.species.find((s) => !s.season && s.evolutions.length === 0)!.id;
/** The fallback wild squishy: a year-round common, the easiest to befriend. */
const COMMON = GAME_DATA.species.find((s) => !s.season && s.rarity === 'common')!.id;

interface BattleDebug {
  status: 'active' | 'finished' | 'no-contest';
  turn: number;
  phase: 'turn' | 'replace' | 'over';
  pending: number;
  waiting: boolean;
  reason: string | null;
  winner: 'a' | 'b' | 'draw' | null;
}

type Hook = {
  __heartpatch?: {
    cinematic?(): { mode: 'first' | 'replay' | null; ended: 'watched' | 'skipped' | null } | null;
    tutorial?(): { status: string | null; stepId: string | null } | null;
    map?(): { id: string; keepers: number } | null;
    battle?(): BattleDebug | null;
    territory?(): { attemptsLeft: number; tileAction: string | null } | null;
  };
};

const story = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.cinematic?.() ?? null);
const tutorial = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.tutorial?.() ?? null);
const mapState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.() ?? null);
const battleState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.battle?.() ?? null);
const territoryState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.territory?.() ?? null);

/** A JSON API call with the player's cookie: status and body. */
const api = (page: Page, method: 'GET' | 'POST', path: string, body?: object) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-requested-with': 'heartpatch' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: (await res.json()) as unknown };
    },
    { method, path, body },
  );

/** Waits for the battle's playback to catch up with the server. */
async function settled(page: Page): Promise<BattleDebug> {
  await expect
    .poll(() => battleState(page), { timeout: 30_000 })
    .toMatchObject({ pending: 0, waiting: false });
  return (await battleState(page))!;
}

/** A touch tap on the canvas as pointer events (as territory.spec.ts does). */
async function tapCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('#game')!;
      for (const type of ['pointerdown', 'pointerup']) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { x, y },
  );
}

/** Taps outward from the Heart Seed until the tile panel offers `action` (territory.spec.ts). */
async function findTile(page: Page, action: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const radius of [60, 80, 100, 130, 160]) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      const at = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
      await tapCanvas(page, at.x, at.y);
      if ((await territoryState(page))?.tileAction === action) return at;
    }
  }
  throw new Error(`no tile offering "${action}" near the Heart Seed`);
}

/**
 * Offers Heart Charms in the battle on screen until the wild squishy says yes.
 * Our level-40 squishy leads (teams go by level) and only offers charms, so
 * the battle ends only by a yes or the turn limit. True if befriended.
 */
async function offerCharms(page: Page): Promise<boolean> {
  const charm = page.getByTestId('battle-capture');
  // The turn limit (50) ends the battle well before this.
  for (let i = 0; i < 60; i++) {
    const state = await settled(page);
    if (state.status !== 'active') {
      await page.getByTestId('battle-done').tap();
      await expect(page.getByTestId('battle-hud')).toBeHidden();
      return state.reason === 'captured';
    }
    await charm.tap();
    await expect.poll(async () => (await battleState(page))?.turn).toBeGreaterThan(state.turn);
  }
  throw new Error('the battle outlasted its turn limit');
}

test('first session: signup, Keeper, story, tutorial, a patch with a friend, a capture, a tile', async ({
  page,
  browser,
}) => {
  // Two signups, the story's world, the Glade, a patch and two battles, in
  // software-rendered WebKit under CI load.
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const name = uniqueName('first');

  // Sign up and pick a Keeper; the story plays next, the first time.
  await signUp(page, name);
  await pickKeeper(page, 'Clover', 'play');
  const cinematic = page.getByTestId('cinematic');
  await expect(cinematic).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await story(page))?.mode, { timeout: 30_000 }).toBe('first');

  // A long press skips it, through the real panel.
  await holdCinematic(page, 1600);
  await expect(cinematic).toBeHidden();
  expect((await story(page))?.ended).toBe('skipped');

  // Sprout's tutorial from the lobby, over its gameplay steps to graduation.
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({
    timeout: 15_000,
  });
  await lobby.getByTestId('tutorial-start').tap();
  await expect
    .poll(async () => (await tutorial(page))?.stepId, { timeout: 30_000 })
    .toBe('welcome');
  expect((await api(page, 'POST', '/tutorial/dev/step', { stepId: 'graduation' })).status).toBe(
    200,
  );
  await expect.poll(async () => (await tutorial(page))?.stepId).toBe('graduation');
  await page.getByTestId('tutorial-bubble').getByRole('button', { name: 'Next' }).tap();
  await page
    .locator('[data-tutorial-target="graduation-choices"]')
    .getByRole('button', { name: 'Make a patch' })
    .tap();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  expect((await tutorial(page))?.status).toBe('completed');
  // The First Patch milestone (#44) celebrates over the lobby.
  const party = page.getByTestId('milestone-card');
  await expect(party).toBeVisible({ timeout: 20_000 });
  await expect(party.getByTestId('milestone-name')).toHaveText('The First Patch');
  await party.getByTestId('milestone-yay').tap();
  await expect(party).toBeHidden();

  // Graduation opened "Make a patch".
  await lobby.getByLabel('Patch name').fill('First Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByRole('heading', { name: 'First Patch' })).toBeVisible();
  const code = (await lobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // A friend asks to join with the code, and the owner says yes.
  const friendName = uniqueName('pal');
  const friend = await newPlayer(browser, friendName);
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code);
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-waiting')).toContainText('First Patch');
  await lobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await lobby.getByRole('button', { name: /First Patch/ }).tap();
  const requests = lobby.getByTestId('lobby-requests');
  await expect(requests).toContainText(`${friendName} wants to join`);
  await requests.getByRole('button', { name: 'Yes!' }).tap();
  await expect(lobby.getByTestId('lobby-members')).toContainText(friendName);
  await friend.context().close();

  // Onto the patch: a starter, then both Keepers at their home bases.
  await visitPatch(lobby);
  await expect(page.getByTestId('map-hud')).toContainText('First Patch');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(async () => (await mapState(page))?.keepers, { timeout: 30_000 }).toBe(2);
  const mapId = (await mapState(page))!.id;

  // A strong squishy and a bag of Heart Charms (dev routes).
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: STRONG,
    level: STRONG_LEVEL,
  });
  expect(granted.status).toBe(201);
  const charms = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { 'heart-charm': 150 },
  });
  expect(charms.status).toBe(201);
  const team = async () =>
    ((await api(page, 'GET', `/maps/${mapId}/care`)).body as { squishies: unknown[] }).squishies
      .length;
  expect(await team()).toBe(2);

  // Befriend the wild squishy nearby with the real button. Whether a charm
  // works is the battle's dice: if the turn limit comes first, a common one
  // from the dev route (still played through the real HUD) gets the charms.
  const note = page.locator('.battle-entry-note');
  await expect(note).toContainText(/nearby/);
  let befriended = false;
  for (let i = 0; i < 3 && !befriended; i++) {
    if (i > 0) {
      const dev = await api(page, 'POST', `/maps/${mapId}/dev/battles`, {
        opponent: { speciesId: COMMON, level: 3 },
      });
      expect(dev.status).toBe(201);
    }
    await page.getByTestId('battle-entry').tap();
    await expect(page.getByTestId('battle-hud')).toBeVisible({ timeout: 30_000 });
    befriended = await offerCharms(page);
  }
  expect(befriended).toBe(true);
  await expect.poll(team).toBe(3);

  // Claim wild land next to home from its guardians.
  await expect.poll(() => territoryState(page)).toMatchObject({ attemptsLeft: 10 });
  const spot = await findTile(page, 'claim');
  await page.getByTestId('tile-claim').tap();
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 60; i++) {
    const current = await settled(page);
    if (current.status !== 'active') break;
    const button = page.getByTestId(current.phase === 'replace' ? 'battle-replace' : 'battle-move');
    await button.first().tap();
  }
  expect(await battleState(page)).toMatchObject({ status: 'finished', winner: 'a' });
  await expect(page.getByTestId('battle-result')).toContainText('This land is yours!');
  await page.getByTestId('battle-done').tap();
  await expect(hud).toBeHidden();
  await expect.poll(() => territoryState(page)).toMatchObject({ attemptsLeft: 9 });
  await expect
    .poll(async () => {
      await tapCanvas(page, spot.x, spot.y);
      return (await territoryState(page))?.tileAction;
    })
    .toBe('watch');

  expect(errors).toEqual([]);
});
