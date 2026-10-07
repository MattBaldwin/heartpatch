import { GAME_DATA } from '@heartpatch/shared';
import { expect, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';

/** The dev squishy's level: strong enough to beat the guardians next to home. */
export const STRONG_LEVEL = 40;
/** A year-round public squishy that grows up before `STRONG_LEVEL`, so the claim evolves it. */
export const STRONG = GAME_DATA.species.find(
  (s) => !s.season && s.evolutions.some((e) => e.level < STRONG_LEVEL),
)!.id;

const territoryState = (page: Page) => hook<{ tileAction: string | null }>(page, 'territory');
const battleState = (page: Page) =>
  hook<{
    status: 'active' | 'finished' | 'no-contest';
    phase: 'turn' | 'replace' | 'over';
    pending: number;
    waiting: boolean;
    winner: 'a' | 'b' | 'draw' | null;
  }>(page, 'battle');
const mapState = (page: Page) => hook<{ selected: string | null }>(page, 'map');

/** A touch tap on the canvas as pointer events (as map.spec.ts does). */
export async function tapCanvas(page: Page, x: number, y: number): Promise<void> {
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
export async function findTile(page: Page, action: string): Promise<{ x: number; y: number }> {
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
 * Claims the first wild tile next to home with a strong dev squishy, playing
 * the guardians' showdown out, and returns the tile. Fires there and
 * gatherers on it are what nightfall cares about (#202).
 */
export async function claimLand(page: Page, mapId: string): Promise<{ q: number; r: number }> {
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: STRONG,
    level: STRONG_LEVEL,
  });
  expect(granted.status).toBe(201);
  await findTile(page, 'claim');
  const [q, r] = (await mapState(page))!.selected!.split(',').map(Number) as [number, number];
  await page.getByTestId('tile-claim').tap();

  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
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
  await page.getByTestId('battle-done').tap();
  await expect(hud).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // The strong squishy grows up from the battle's XP (#19): say yay and close.
  await expect(page.getByTestId('care-celebrate')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('care-yay').tap();
  await page.getByTestId('care-close').tap();
  await expect(page.getByTestId('care')).toBeHidden();
  return { q, r };
}
