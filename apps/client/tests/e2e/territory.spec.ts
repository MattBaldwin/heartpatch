import {
  attackTargetProblem,
  findAvoidedWords,
  GAME_DATA,
  TERRITORY_RULES,
  type MapView,
  type PlayerBattle,
} from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/** The dev squishy's level: strong enough to beat the guardians next to home. */
const STRONG_LEVEL = 40;
/** A year-round public squishy that grows up before `STRONG_LEVEL`, so the claim evolves it. */
const STRONG = GAME_DATA.species.find(
  (s) => !s.season && s.evolutions.some((e) => e.level < STRONG_LEVEL),
)!.id;

/**
 * Territory on an iPhone (issue #15): claim wild land next to your home base
 * by winning a showdown with its guardians, see it become yours, light a
 * Hearthfire in its middle (#202), and post a guard on it. Checked through the dev hook's signals, never pixels.
 */

/** `TerritoryDebug` from src/territory/territory-screen.ts (this project can't see its types). */
interface TerritoryDebug {
  mapId: string;
  attemptsLeft: number;
  onWatch: number;
  tileAction: string | null;
  picking: boolean;
}

interface BattleDebug {
  scene: { shadowLook: number } | null;
  status: 'active' | 'finished' | 'no-contest';
  phase: 'turn' | 'replace' | 'over';
  pending: number;
  waiting: boolean;
  winner: 'a' | 'b' | 'draw' | null;
}

const territoryState = (page: Page) => hook<TerritoryDebug>(page, 'territory');
const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');
const mapState = (page: Page) =>
  hook<{ id: string; selected: string | null; litFires: number }>(page, 'map');

/** A touch tap on the canvas as pointer events (as map.spec.ts does). */
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

/**
 * Taps outward from the Heart Seed (where the camera starts) until the tile
 * panel offers `action` on a tile `fits` (by its "q,r"); returns where it
 * tapped. Wild land rings every home base just past its ring (design doc §11).
 */
async function findTile(
  page: Page,
  action: string,
  fits: (key: string) => boolean = () => true,
): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const radius of [60, 80, 100, 130, 160]) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      const at = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
      await tapCanvas(page, at.x, at.y);
      if ((await territoryState(page))?.tileAction !== action) continue;
      const selected = (await mapState(page))?.selected ?? null;
      if (selected !== null && fits(selected)) return at;
    }
  }
  throw new Error(`no tile offering "${action}" that fits near the Heart Seed`);
}

test('claims wild land from its guardians and posts a guard on it', async ({ browser }) => {
  test.setTimeout(240_000); // map and arena builds and a log playback; CI renders in software
  const page = await newPlayer(browser, uniqueName('claim'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Claiming Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect
    .poll(() => territoryState(page))
    .toMatchObject({ attemptsLeft: TERRITORY_RULES.attemptsPerDay, onWatch: 0 });

  // A strong squishy from the dev route, next to their level-1 starter.
  const mapId = (await mapState(page))!.id;
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: STRONG,
    level: STRONG_LEVEL,
  });
  expect(granted.status).toBe(201);
  // Timber, Stone and Emberwood for a fire on the new land.
  const stuff = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 10, stone: 10, emberwood: 10 },
  });
  expect(stuff.status).toBe(201);

  // Wild land next to home: the panel says Claim, kindly. A Hearthfire goes in
  // a tile's middle (#202), so the land claimed here has no resource node
  // there: many wild terrains put one on 40–50% of their tiles, and a node
  // tile's panel rightly offers no fire ("a fire next door can reach it").
  const { body: wild } = await api<MapView>(page, 'GET', `/maps/${mapId}/view`);
  const clear = new Set(
    wild.tiles.filter((t) => t.nodeResource === null).map((t) => `${String(t.q)},${String(t.r)}`),
  );
  const spot = await findTile(page, 'claim', (key) => clear.has(key));
  const panel = page.getByTestId('tile-panel');
  // Any wait: in the patch's last hour it's minutes, or "less than a minute".
  await expect(panel).toContainText(
    /tries left · new tries in (\d+h( \d{2}m)?|\d+m|less than a minute)/,
  );
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);
  // How many guardians and how tough (owner decision 10), as the server's view
  // says for the tile the map has selected; never who.
  const selected = (await mapState(page))!.selected!;
  const { body: view } = await api<{
    tiles: {
      q: number;
      r: number;
      guardianHint: { count: number; difficulty: string } | null;
    }[];
  }>(page, 'GET', `/maps/${mapId}/view`);
  const hint =
    view.tiles.find((t) => `${String(t.q)},${String(t.r)}` === selected)?.guardianHint ?? null;
  expect(hint).not.toBeNull();
  const words = { easy: 'easy', tough: 'tough', 'very-tough': 'very tough' } as const;
  const who = hint!.count === 1 ? '1 sleepy squishy' : `${String(hint!.count)} sleepy squishies`;
  await expect(page.getByTestId('tile-panel-guardians')).toHaveText(
    `Guarded by ${who} • ${words[hint!.difficulty as keyof typeof words]}`,
  );
  await page.getByTestId('tile-claim').tap();

  // The guardians' showdown takes the screen; play it out.
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('battle-caption')).toContainText('guardians');
  // Tile guardians aren't the Hollow's shadows: they look like themselves.
  await expect.poll(async () => (await battleState(page))?.scene?.shadowLook).toBe(0);
  for (let i = 0; i < 60; i++) {
    await expect
      .poll(() => battleState(page), { timeout: 30_000 })
      .toMatchObject({ pending: 0, waiting: false });
    const current = (await battleState(page))!;
    if (current.status !== 'active') break;
    const button = page.getByTestId(current.phase === 'replace' ? 'battle-replace' : 'battle-move');
    await button.first().tap();
  }
  expect(await battleState(page)).toMatchObject({ status: 'finished', winner: 'a' });
  await expect(page.getByTestId('battle-result')).toContainText('This land is yours!');
  await page.getByTestId('battle-done').tap();
  await expect(hud).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // The level-40 dev squishy is past its evolution level, so the battle's XP grows
  // it up and the care sheet celebrates (#19): say yay and close it.
  await expect(page.getByTestId('care-celebrate')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('care-yay').tap();
  await expect(page.getByTestId('care-celebrate')).toBeHidden();
  await page.getByTestId('care-close').tap();
  await expect(page.getByTestId('care')).toBeHidden();

  // Back on the map: one try used, and the same spot is ours to guard now.
  await expect
    .poll(() => territoryState(page))
    .toMatchObject({ attemptsLeft: TERRITORY_RULES.attemptsPerDay - 1 });
  await expect
    .poll(async () => {
      await tapCanvas(page, spot.x, spot.y);
      return (await territoryState(page))?.tileAction;
    })
    .toBe('watch');
  await expect(page.getByTestId('territory-watch')).toContainText('Nobody stands watch');
  // No fire reaches it yet: a guard here would stand in the dark (owner decision 2026-10-07).
  await expect(page.getByTestId('territory-dark')).toHaveText(
    "It's dark here at night. Build a fire nearby to keep your guard safe! 🔥",
  );

  // A Hearthfire in the new land's middle (#202): build it, then fuel it to light it.
  await page.getByTestId('tile-build-fire').tap();
  await expect(panel).toContainText('It goes in the middle of this tile');
  await page.getByTestId('tile-build-fire-confirm').tap();
  await expect(page.getByTestId('tile-fire')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('tile-fire-fuel').tap();
  await expect(page.getByTestId('tile-fire-note')).toContainText('Lit!', { timeout: 30_000 });
  await expect.poll(async () => (await mapState(page))?.litFires, { timeout: 30_000 }).toBe(1);
  // Lit, its light reaches the guard's post.
  await expect(page.getByTestId('territory-dark')).toHaveCount(0, { timeout: 30_000 });

  // Post a squishy on watch there (the starter and the strong one to choose from).
  await page.getByTestId('territory-pick').tap();
  const picker = page.getByTestId('territory-picker');
  await expect(picker.getByRole('button')).toHaveCount(2);
  await picker.getByRole('button').first().tap();
  await expect(picker.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('territory-save').tap();
  await expect.poll(() => territoryState(page)).toMatchObject({ onWatch: 1, picking: false });
  await expect(page.getByTestId('territory-watch')).toContainText('On watch: 1 of 3');
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);

  expect(errors).toEqual([]);
});

test('says when tries come back once they are used up (#201)', async ({ browser }) => {
  test.setTimeout(300_000); // a reload rebuilds the map; CI renders in software
  const page = await newPlayer(browser, uniqueName('tries'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Tries Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect
    .poll(() => territoryState(page), { timeout: 30_000 })
    .toMatchObject({ attemptsLeft: TERRITORY_RULES.attemptsPerDay });

  // Use every try through the API: start a claim on a different wild tile
  // each time (a fought-over tile rests), and scoot home straight away.
  const mapId = (await mapState(page))!.id;
  const me = (await api<{ user: { id: string } }>(page, 'GET', '/me')).body.user.id;
  const { body: view } = await api<MapView>(page, 'GET', `/maps/${mapId}/view`);
  const wild = view.tiles.filter(
    (t) => attackTargetProblem(t, view.tiles, me, view.map.pvpMode) === null,
  );
  expect(wild.length).toBeGreaterThanOrEqual(TERRITORY_RULES.attemptsPerDay);
  for (const tile of wild.slice(0, TERRITORY_RULES.attemptsPerDay)) {
    const started = await api<{ battle: PlayerBattle }>(page, 'POST', `/maps/${mapId}/attacks`, {
      q: tile.q,
      r: tile.r,
    });
    expect(started.status).toBe(201);
    const { battle } = started.body;
    const ended = await api(page, 'POST', `/battles/${battle.id}/actions`, {
      action: { type: 'forfeit' },
      turn: battle.view.turn,
    });
    expect(ended.status).toBe(200);
  }

  // Back on the patch (a reload lands there), wild land says when tries come back.
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  // Roomy: a reload rebuilds the map scene, slow on a software-rendered runner.
  await expect
    .poll(() => territoryState(page), { timeout: 30_000 })
    .toMatchObject({ attemptsLeft: 0 });
  await findTile(page, 'no-tries');
  await expect(page.getByTestId('territory-tries')).toHaveText(
    /^New tries in (\d+h( \d{2}m)?|\d+m|less than a minute) 🌙$/,
  );
  expect(findAvoidedWords((await page.getByTestId('tile-panel').textContent()) ?? '')).toEqual([]);
  await page.context().close();
});
