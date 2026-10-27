import { GAME_DATA } from '@heartpatch/shared';
import { expect, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { traysState } from './trays.js';
import { bigMoveButton } from './big-move.js';

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

/** Opens `tile`'s panel through the dev hook (`mapDev().select`), as a tap on it would. */
export async function selectTile(page: Page, tile: { q: number; r: number }): Promise<void> {
  const key = `${String(tile.q)},${String(tile.r)}`;
  await expect
    .poll(
      async () => {
        await page.evaluate(
          ({ q, r }) =>
            (
              window as unknown as {
                __heartpatch?: { mapDev?: () => { select: (q: number, r: number) => boolean } };
              }
            ).__heartpatch
              ?.mapDev?.()
              .select(q, r),
          tile,
        );
        return (await mapState(page))?.selected;
        // The map selects only once its 3D scene is built (`focus`), which can
        // trail the live map by more than the default 5 s on a slow iPhone runner.
      },
      { timeout: 20_000 },
    )
    .toBe(key);
}

/** Taps outward from the middle of the map until `tile` is the selected one. */
export async function tapTile(page: Page, tile: { q: number; r: number }): Promise<void> {
  const key = `${String(tile.q)},${String(tile.r)}`;
  const box = (await page.locator('#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const radius of [0, 40, 60, 80, 100, 130, 160]) {
    for (let step = 0; step < (radius === 0 ? 1 : 12); step++) {
      const angle = (step * Math.PI) / 6;
      await tapCanvas(page, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      if ((await mapState(page))?.selected === key) return;
    }
  }
  throw new Error(`couldn't tap the tile ${key}`);
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
  // An open side tray covers part of the map and the tile panel: shut it first.
  const open = (await traysState(page))?.open ?? null;
  if (open !== null) {
    await page.getByTestId(`tray-handle-${open}`).tap();
    await expect.poll(async () => (await traysState(page))?.open, { timeout: 15_000 }).toBeNull();
  }
  await findTile(page, 'claim');
  const [q, r] = (await mapState(page))!.selected!.split(',').map(Number) as [number, number];
  await page.getByTestId('tile-claim').tap();
  await playClaimBattle(page);
  return { q, r };
}

/**
 * Plays the claim's showdown out from the open Battle sheet (big moves, a
 * replacement when one faints) and closes the care celebration the winner's
 * level-up brings (`evolves`: false once the squishy has grown up). The
 * tile's claim button has been tapped already.
 */
export async function playClaimBattle(page: Page, evolves = true): Promise<void> {
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 60; i++) {
    await expect
      .poll(() => battleState(page), { timeout: 30_000 })
      .toMatchObject({ pending: 0, waiting: false });
    const current = (await battleState(page))!;
    if (current.status !== 'active') break;
    // A big move: steady ones are gentle with a neutral land's guardians (#587).
    const button =
      current.phase === 'replace'
        ? page.getByTestId('battle-replace').first()
        : await bigMoveButton(page);
    await button.tap();
  }
  expect(await battleState(page)).toMatchObject({ status: 'finished', winner: 'a' });
  await page.getByTestId('battle-done').tap();
  await expect(hud).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // The strong squishy grows up from the battle's XP (#19): say yay and close.
  if (!evolves) return;
  await expect(page.getByTestId('care-celebrate')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('care-yay').tap();
  await page.getByTestId('care-close').tap();
  await expect(page.getByTestId('care')).toBeHidden();
}
