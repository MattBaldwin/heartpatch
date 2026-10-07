import { findAvoidedWords, GAME_DATA, TERRITORY_RULES } from '@heartpatch/shared';
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
 * by winning a showdown with its guardians, see it become yours, and post a
 * guard on it. Checked through the dev hook's signals, never pixels.
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
const mapState = (page: Page) => hook<{ id: string; selected: string | null }>(page, 'map');

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
 * panel offers `action`; returns where it tapped. Wild land rings every home
 * base just past its ring (design doc §11).
 */
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

  // Wild land next to home: the panel says Claim, kindly.
  const spot = await findTile(page, 'claim');
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toContainText('tries left today');
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);
  // How many guardians, how they feel (#216) and how tough (owner decision
  // 10), as the server's view says for the tile the map has selected; never who.
  const selected = (await mapState(page))!.selected!;
  const { body: view } = await api<{
    tiles: {
      q: number;
      r: number;
      guardianHint: { count: number; difficulty: string; feelings: string[] } | null;
    }[];
  }>(page, 'GET', `/maps/${mapId}/view`);
  const hint =
    view.tiles.find((t) => `${String(t.q)},${String(t.r)}` === selected)?.guardianHint ?? null;
  expect(hint).not.toBeNull();
  const words = { easy: 'easy', tough: 'tough', 'very-tough': 'very tough' } as const;
  const guardians = page.getByTestId('tile-panel-guardians');
  await expect(guardians).toContainText(`Guarded by ${String(hint!.count)} `);
  await expect(guardians).toContainText(`• ${words[hint!.difficulty as keyof typeof words]}`);
  expect(hint!.feelings).toHaveLength(hint!.count);
  for (const id of hint!.feelings) {
    const name = GAME_DATA.feelings.find((f) => f.id === id)!.name;
    await expect(guardians).toContainText(name);
  }
  await expect(guardians).not.toContainText('sleepy squish');
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
