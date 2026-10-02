import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

/**
 * A PvE battle on an iPhone (issue #13): pick a fight, play it to the end,
 * and resume it after a refresh. Everything is checked through the dev hook's
 * signals (turn, phase, bar energies), never pixels.
 */

/** `BattleDebug` from src/battle/battle-screen.ts (this project can't see its types). */
interface BattleDebug {
  id: string;
  status: 'active' | 'finished' | 'no-contest';
  turn: number;
  phase: 'turn' | 'replace' | 'over';
  shown: { mine: number; theirs: number };
  pending: number;
  waiting: boolean;
  winner: 'a' | 'b' | 'draw' | null;
  scene: { squishies: number; meshes: number; instances: number } | null;
}

type Hook = { __heartpatch?: { battle?(): BattleDebug | null; map?(): unknown } };

function battleState(page: Page): Promise<BattleDebug | null> {
  return page.evaluate(() => (window as unknown as Hook).__heartpatch?.battle?.() ?? null);
}

/** Waits until the log has played out and the player may act (or the battle is over). */
async function settled(page: Page): Promise<BattleDebug> {
  await expect
    .poll(() => battleState(page), { timeout: 30_000 })
    .toMatchObject({ pending: 0, waiting: false });
  return (await battleState(page))!;
}

async function openPatch(page: Page, name: string): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: new RegExp(name) }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(lobby).toBeHidden();
}

test('plays a wild battle to the end and resumes it after a refresh', async ({ browser }) => {
  test.setTimeout(240_000); // five scene builds and a whole log playback; CI renders in software
  const name = uniqueName('kid');
  const page = await newPlayer(browser, name);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // A patch to battle on.
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Showdown Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(lobby).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Showdown Patch');

  // With no squishy of their own yet, the real button says so kindly (or, if
  // no wild squishy is about this window, that nobody's around)…
  const entry = page.getByTestId('battle-entry');
  await expect(entry).toBeVisible();
  await entry.tap();
  await expect(page.locator('.battle-entry-note')).toContainText(
    /No wild squishies|squishy friend/,
  );
  // …and the dev tools hand out a squishy and a fight.
  await page.getByTestId('battle-dev-grant').tap();
  await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  await page.getByTestId('battle-dev-fight').tap();

  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible();
  await expect(page.getByTestId('map-hud')).toBeHidden();
  let state = await settled(page);
  expect(state).toMatchObject({ status: 'active', turn: 0, phase: 'turn' });
  const battleId = state.id;
  // Two squishies stand in the arena; bars start full.
  await expect.poll(() => battleState(page).then((s) => s?.scene?.squishies)).toBe(2);
  expect(state.shown.mine).toBeGreaterThan(0);
  expect(state.shown.theirs).toBeGreaterThan(0);
  await expect(page.getByTestId('battle-plate-mine')).toContainText('Lv');
  await expect(page.getByTestId('battle-plate-theirs')).toContainText('Lv');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // The client can't forge an outcome: the engine's own action shape is refused.
  const forged = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/battles/${id}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'heartpatch' },
      body: JSON.stringify({
        action: { type: 'turn', choices: { b: { type: 'move', move: 'x' } } },
        turn: 0,
      }),
    });
    return res.status;
  }, battleId);
  expect(forged).toBe(400);

  // One move: the log plays, then the bars show the server's numbers.
  const before = state.shown;
  await page.getByTestId('battle-move').first().tap();
  state = await settled(page);
  expect(state.turn).toBe(1);
  await expect(page.getByTestId('battle-caption')).not.toBeEmpty();
  expect(state.shown.mine + state.shown.theirs).toBeLessThan(before.mine + before.theirs);

  // Refreshing mid-battle resumes it: same battle, same turn, bars where they were.
  await page.reload();
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  await openPatch(page, 'Showdown Patch');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  const resumed = await settled(page);
  expect(resumed).toMatchObject({ id: battleId, turn: 1, status: 'active', shown: state.shown });
  await expect(page.getByTestId('battle-caption')).toContainText('Welcome back');

  // Play it out: first move every turn until it's over (max turns is 50).
  for (let i = 0; i < 60; i++) {
    const current = await settled(page);
    if (current.status !== 'active') break;
    const button = page.getByTestId(current.phase === 'replace' ? 'battle-replace' : 'battle-move');
    await button.first().tap();
  }
  const over = await settled(page);
  expect(over).toMatchObject({ id: battleId, status: 'finished', phase: 'over' });
  expect(over.winner).not.toBeNull();
  // Someone is tuckered out, unless the battle ran out of turns (a tie).
  if (over.winner !== 'draw') expect(over.shown.mine === 0 || over.shown.theirs === 0).toBe(true);

  const result = page.getByTestId('battle-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText(/Hooray|tuckered|tie/);
  await expect(page.getByTestId('battle-xp')).toContainText(/XP/);
  await page.getByTestId('battle-done').tap();
  await expect(hud).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Showdown Patch');
  expect(await battleState(page)).toBeNull();
  await expect(page.getByTestId('battle-entry')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a battle owns the screen: no lobby button mid-battle, no battle button in the Glade', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('own'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Owner Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(page.getByTestId('map-hud')).toContainText('Owner Patch');
  const entry = page.getByTestId('battle-entry');
  const lobbyButton = page.getByTestId('lobby-open');
  await expect(entry).toBeVisible();
  await expect(lobbyButton).toBeVisible();

  // Mid-battle, "My patches" steps out: the battle is the only screen.
  await page.getByTestId('battle-dev-grant').tap();
  await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  await page.getByTestId('battle-dev-fight').tap();
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible();
  await settled(page);
  await expect(lobbyButton).toBeHidden();
  await expect(entry).toBeHidden();

  // Back keeps the battle going and hands the map back, button and all.
  await hud.getByRole('button', { name: 'Back to patch' }).tap();
  await expect(hud).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Owner Patch');
  await expect(lobbyButton).toBeVisible();
  await expect(entry).toBeVisible();
  expect(await battleState(page)).toBeNull();

  // Visiting the patch again from the lobby resumes the battle, and the
  // lobby button steps out again.
  await lobbyButton.tap();
  await openPatch(page, 'Owner Patch');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await expect(lobbyButton).toBeHidden();
  await hud.getByRole('button', { name: 'Back to patch' }).tap();
  await expect(hud).toBeHidden();

  // Sprout's Glade (#47) is drawn by the map screen too, but it's Sprout's:
  // no battle button over it, and none left behind after "Later".
  await lobbyButton.tap();
  await lobby.getByTestId('tutorial-start').tap();
  await expect(page.getByTestId('tutorial-bubble')).toBeVisible({ timeout: 30_000 });
  await expect(entry).toBeHidden();
  await page.getByTestId('tutorial-bubble').getByRole('button', { name: 'Later' }).tap();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await lobby.getByTestId('lobby-close').tap();
  await expect(entry).toBeHidden();
  expect(
    await page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.() ?? null),
  ).toBeNull();

  expect(errors).toEqual([]);
});
