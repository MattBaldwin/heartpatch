import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/** The bag and the tile panel's gather action, from the dev hook (`InventoryDebug`). */
interface InventoryDebug {
  mapId: string;
  items: Record<string, number>;
  gathers: number;
  crafts: number;
  seasons: string[];
  bagOpen: boolean;
  tileAction: string | null;
}

function bagState(page: Page): Promise<InventoryDebug | null> {
  return hook<InventoryDebug>(page, 'inventory');
}

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
 * Taps around the Heart Seed (where the camera starts) until the tile panel
 * offers "Gather": every home ring has Timber, Stone, Emberwood and a farm
 * plot (design doc §11), so one of the six neighbours is a node of ours.
 */
async function findOwnNode(page: Page): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const radius of [40, 60, 80, 100, 130]) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      await tapCanvas(page, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      if ((await bagState(page))?.tileAction === 'gather') return;
    }
  }
  throw new Error('no node of ours near the Heart Seed');
}

test('gathers on an owned node and crafts a Heart Charm from the bag', async ({ browser }) => {
  test.setTimeout(120_000); // a full map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('bag'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Gathering Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect
    .poll(
      async () => (await hook<{ tiles: number; selected: string | null }>(page, 'map'))?.tiles,
      {
        timeout: 30_000,
      },
    )
    .toBe(469);

  // The bag starts with just Sprout's Heart Charms from the first starter pick
  // (owner decision 2026-10-04), on the server's season (the dev server runs
  // on today's date).
  const state = await bagState(page);
  expect(state).toMatchObject({
    items: { 'heart-charm': 3 },
    gathers: 0,
    crafts: 0,
    bagOpen: false,
  });

  // Gather on one of our home nodes: the panel counts down on the server clock.
  await findOwnNode(page);
  const panel = page.getByTestId('tile-panel');
  await expect(panel.getByTestId('tile-panel-actions')).toContainText('Gives +');
  await panel.getByTestId('tile-gather').tap();
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(1);
  expect((await bagState(page))?.tileAction).toBe('waiting');
  await expect(panel.getByTestId('tile-panel-actions')).toContainText('Gathering… ready in');
  await panel.getByRole('button', { name: 'Close' }).tap();

  // The bag shows the gather, and crafting uses items up front.
  await (await trayButton(page, 'bag-open')).tap();
  const bag = page.getByTestId('bag');
  await expect(bag).toBeVisible();
  // Nothing gathered yet: only Sprout's Heart Charms.
  await expect.poll(async () => (await bagState(page))?.items).toEqual({ 'heart-charm': 3 });
  await expect(bag.locator('[data-item="heart-charm"]')).toContainText('3');
  await expect(bag.getByTestId('bag-gathers')).toContainText(/\d/);
  await bag.getByRole('button', { name: 'Get stuff (dev)' }).tap();
  await expect.poll(async () => (await bagState(page))?.items['timber']).toBe(10);
  await expect(bag.locator('[data-item="timber"]')).toContainText('10');

  await bag.locator('[data-recipe="heart-charm"]').tap();
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);
  expect((await bagState(page))?.items['timber']).toBe(8);
  await expect(bag.getByTestId('bag-crafts')).toContainText('Making Heart Charm');
  await expect(bag.locator('[data-recipe-row="heart-charm"]')).toContainText(
    'Your pot is busy! Collect first.',
  );

  // Kid-friendly words only (style guide §9).
  const text = (await bag.textContent()) ?? '';
  expect(findAvoidedWords(text)).toEqual([]);
  await bag.getByRole('button', { name: 'Close' }).tap();
  await expect(bag).toBeHidden();

  // Leaving the map (here: Settings → Change Keeper, #42) takes the bag with it.
  await page.getByRole('button', { name: 'My patches' }).tap();
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('keeper-settings').tap();
  await expect(page.getByTestId('keeper-picker')).toBeVisible();
  await expect.poll(() => bagState(page)).toBeNull();
  await expect(page.getByTestId('bag-open')).toBeHidden();
  expect(errors).toEqual([]);
});
