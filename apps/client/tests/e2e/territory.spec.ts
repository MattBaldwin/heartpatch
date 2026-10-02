import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

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
  status: 'active' | 'finished' | 'no-contest';
  phase: 'turn' | 'replace' | 'over';
  pending: number;
  waiting: boolean;
  winner: 'a' | 'b' | 'draw' | null;
}

type Hook = {
  __heartpatch?: {
    territory?(): TerritoryDebug | null;
    battle?(): BattleDebug | null;
    map?(): { id: string; selected: string | null } | null;
  };
};

const territoryState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.territory?.() ?? null);
const battleState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.battle?.() ?? null);
const mapState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.() ?? null);

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
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => territoryState(page)).toMatchObject({ attemptsLeft: 10, onWatch: 0 });

  // A strong squishy from the dev route (the starter comes with the tutorial, #24).
  const mapId = (await mapState(page))!.id;
  const granted = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/maps/${id}/dev/squishies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'heartpatch' },
      body: JSON.stringify({ level: 40 }),
    });
    return res.status;
  }, mapId);
  expect(granted).toBe(201);

  // Wild land next to home: the panel says Claim, kindly.
  const spot = await findTile(page, 'claim');
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toContainText('tries left today');
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);
  await page.getByTestId('tile-claim').tap();

  // The guardians' showdown takes the screen; play it out.
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('battle-caption')).toContainText('guardians');
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

  // Back on the map: one try used, and the same spot is ours to guard now.
  await expect.poll(() => territoryState(page)).toMatchObject({ attemptsLeft: 9 });
  await expect
    .poll(async () => {
      await tapCanvas(page, spot.x, spot.y);
      return (await territoryState(page))?.tileAction;
    })
    .toBe('watch');
  await expect(page.getByTestId('territory-watch')).toContainText('Nobody stands watch');

  // Post the squishy on watch there.
  await page.getByTestId('territory-pick').tap();
  const picker = page.getByTestId('territory-picker');
  await expect(picker.getByRole('button')).toHaveCount(1);
  await picker.getByRole('button').first().tap();
  await expect(picker.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('territory-save').tap();
  await expect.poll(() => territoryState(page)).toMatchObject({ onWatch: 1, picking: false });
  await expect(page.getByTestId('territory-watch')).toContainText('On watch: 1 of 3');
  expect(findAvoidedWords((await panel.textContent()) ?? '')).toEqual([]);

  expect(errors).toEqual([]);
});
