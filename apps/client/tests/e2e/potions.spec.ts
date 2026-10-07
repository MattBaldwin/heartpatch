import { expect, test, type Page } from '@playwright/test';
import { findAvoidedWords } from '@heartpatch/shared';
import { api, hook } from './dev-hook.js';
import { expectRoomyLabels } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap } from './touch.js';
import { trayButton } from './trays.js';

/**
 * Battle potions (#214): craft a Brave Brew from dev items, drink it in a
 * wild battle from the "Use item" picker, and see the ⚔️+ chip on the pill.
 */

interface BattleDebug {
  turn: number;
  pending: number;
  waiting: boolean;
  potions: Record<string, number> | null;
}

const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');

async function settled(page: Page): Promise<BattleDebug> {
  await expect
    .poll(() => battleState(page), { timeout: 30_000 })
    .toMatchObject({ pending: 0, waiting: false });
  return (await battleState(page))!;
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('crafts a Brave Brew, drinks it in a wild battle, and shows the chip', async ({ browser }) => {
  test.setTimeout(240_000); // a map build and a battle; CI renders in software
  const page = await newPlayer(browser, uniqueName('potion'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Potion Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;

  // Craft one from dev items: the recipe page opens once Treats and Stone are in.
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/items`, { items: { treats: 2, stone: 2 } }))
      .status,
  ).toBe(201);
  const craft = await api<{ craft: { id: string } }>(page, 'POST', `/maps/${mapId}/crafts`, {
    recipeId: 'brave-brew',
  });
  expect(craft.status).toBe(201);
  expect((await api(page, 'POST', `/maps/${mapId}/dev/crafts/ready`)).status).toBe(200);
  const craftId = craft.body.craft.id;
  expect((await api(page, 'POST', `/maps/${mapId}/crafts/${craftId}/collect`)).status).toBe(200);
  const bag = await api<{ items: Record<string, number> }>(page, 'GET', `/maps/${mapId}/inventory`);
  expect(bag.body.items['brave-brew']).toBe(1);

  // A wild battle: "Use item" counts the bag.
  await realTap(await trayButton(page, 'battle-dev-fight'));
  await expect(page.getByTestId('battle-hud')).toBeVisible();
  let state = await settled(page);
  await expect(page.getByTestId('battle-item')).toHaveText('Use item (1)');
  expect(state.potions?.['brave-brew']).toBe(1);
  await expect(page.getByTestId('battle-chip-attack-mine')).toBeHidden();

  // The picker: Brave Brew ready, the others dimmed with a reason.
  await realTap(page.getByTestId('battle-item'));
  const brew = page.locator('[data-testid="battle-item-pick"][data-item="brave-brew"]');
  await expect(brew).toHaveAttribute('data-state', 'ready');
  await expect(
    page.locator('[data-testid="battle-item-pick"][data-item="hearty-soup"]'),
  ).toHaveAttribute('data-state', 'empty');
  await expectRoomyLabels(page, '.battle-item, .battle-button, .battle-ask');
  expect(findAvoidedWords((await page.getByTestId('battle-sheet').textContent()) ?? '')).toEqual(
    [],
  );

  // One tap drinks it: the turn is spent, the chip shows, the bag is empty.
  await realTap(brew);
  state = await settled(page);
  expect(state.turn).toBe(1);
  await expect(page.getByTestId('battle-chip-attack-mine')).toBeVisible();
  await expect.poll(async () => (await battleState(page))?.potions?.['brave-brew'] ?? 0).toBe(0);
  await expect(page.getByTestId('battle-item')).toHaveText('Use item (0)');

  // Another one is "Had one!" this battle.
  await realTap(page.getByTestId('battle-item'));
  await expect(brew).toHaveAttribute('data-state', 'used');
  await realTap(page.getByTestId('battle-item-back'));
  expect(errors).toEqual([]);
});
