import { expect, test, type Page } from '@playwright/test';
import { findAvoidedWords } from '@heartpatch/shared';
import { api, hook } from './dev-hook.js';
import { expectRoomyLabels } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap } from './touch.js';
import { trayButton } from './trays.js';

/**
 * Battle potions (#214): craft a Brave Brew from dev items, sip it in a wild
 * battle from the "Use item" picker, and see the ⚔️+ chip on the pill. A
 * potion is a free sip (#403): the move picker stays open, and the sip goes
 * out with the move.
 */

interface BattleDebug {
  id: string;
  turn: number;
  pending: number;
  waiting: boolean;
  potions: Record<string, number> | null;
  sipped: string | null;
  scene: { shields: { a: boolean; b: boolean }; effects: { spawned: number } } | null;
}

interface BattleLog {
  battle: { view: { log: { turn: number; side?: string; type: string }[] } };
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
  test.setTimeout(300_000); // a map build and a battle; CI renders in software
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

  // A wild battle: "Use item" counts the bag. The dev fight is always the first
  // species (puddlepuff), whose Belly Flop can make the sipper dizzy and skip the
  // move this test waits for (#429). Fight Emberbun instead: it has no status moves.
  await page.route('**/api/v1/maps/*/dev/battles', (route) =>
    route.continue({ postData: JSON.stringify({ opponent: { speciesId: 'emberbun' } }) }),
  );
  await realTap(await trayButton(page, 'battle-dev-fight'));
  await expect(page.getByTestId('battle-hud')).toBeVisible();
  const state = await settled(page);
  await expect(page.getByTestId('battle-item')).toHaveText('🧪 1');
  await expect(page.getByTestId('battle-item')).toHaveAccessibleName('Use item, 1 in your bag');
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
  // Back is fully in view, inside the sheet (it clips what overflows).
  await expect(page.getByTestId('battle-item-back')).toBeInViewport({ ratio: 1 });
  const sheetBox = (await page.getByTestId('battle-sheet').boundingBox())!;
  const backBox = (await page.getByTestId('battle-item-back').boundingBox())!;
  expect(backBox.y + backBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height + 0.5);
  expect(findAvoidedWords((await page.getByTestId('battle-sheet').textContent()) ?? '')).toEqual(
    [],
  );

  // One tap sips it (#403): "Sipped ✓", a sparkle and the shield bubble, the
  // chip, and the moves stay open. Nothing has gone out yet: still turn 0.
  const sparkles = state.scene?.effects.spawned ?? 0;
  await realTap(brew);
  const sippedButton = page.getByTestId('battle-item');
  await expect(sippedButton).toHaveText('🧪 Sipped ✓');
  await expect(sippedButton).toHaveAccessibleName('Brave Brew sipped. Tap to put it back.');
  await expect(page.getByTestId('battle-move').first()).toBeVisible();
  await expect(page.getByTestId('battle-caption')).toContainText('Now pick a move!');
  await expect(page.getByTestId('battle-chip-attack-mine')).toBeVisible();
  await expect(page.getByTestId('battle-chip-shield-mine')).toBeVisible();
  await expect
    .poll(async () => (await battleState(page))?.scene?.shields.a, { timeout: 10_000 })
    .toBe(true);
  const sipped = (await battleState(page))!;
  expect(sipped.sipped).toBe('brave-brew');
  expect(sipped.turn).toBe(0);
  expect(sipped.scene!.effects.spawned).toBeGreaterThan(sparkles);
  // The sip rides with a move: the Heart Charm and Swap wait.
  await expect(page.getByTestId('battle-capture')).toBeHidden();
  await expectRoomyLabels(page, '.battle-button');

  // Forgiving: tap "Sipped ✓" to put it back, then sip it again.
  await realTap(sippedButton);
  await expect(sippedButton).toHaveText('🧪 1');
  await expect(page.getByTestId('battle-chip-attack-mine')).toBeHidden();
  expect((await battleState(page))?.sipped).toBeNull();
  await realTap(sippedButton);
  await realTap(brew);
  await expect(sippedButton).toHaveText('🧪 Sipped ✓');

  // A refused move (the bag ran dry on another device) takes the sip back,
  // and nothing still says "Sipped".
  await page.route('**/api/v1/battles/*/actions', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'CONFLICT', message: 'No Brave Brew left!' } }),
    }),
  );
  await realTap(page.getByTestId('battle-move').first());
  await expect(sippedButton).toHaveText(/🧪/);
  await expect(sippedButton).not.toHaveText(/Sipped/);
  await expect(page.getByTestId('battle-caption')).not.toContainText('Sipped');
  await expect(page.getByTestId('battle-chip-attack-mine')).toBeHidden();
  expect((await battleState(page))?.sipped).toBeNull();
  await page.unroute('**/api/v1/battles/*/actions');
  await settled(page);
  await realTap(sippedButton);
  await realTap(brew);
  await expect(sippedButton).toHaveText('🧪 Sipped ✓');

  // Then a move: one turn plays, with the sip first and the move still made.
  await realTap(page.getByTestId('battle-move').first());
  await expect.poll(async () => (await battleState(page))?.turn, { timeout: 30_000 }).toBe(1);
  await settled(page);
  await expect(page.getByTestId('battle-chip-attack-mine')).toBeVisible();
  await expect.poll(async () => (await battleState(page))?.potions?.['brave-brew'] ?? 0).toBe(0);
  await expect(page.getByTestId('battle-item')).toHaveText('🧪 0');
  const played = await api<BattleLog>(page, 'GET', `/battles/${sipped.id}`);
  const mine = played.body.battle.view.log.filter((e) => e.turn === 1 && e.side === 'a');
  expect(mine[0]?.type).toBe('item');
  expect(mine.map((e) => e.type)).toContain('move');

  // Another one is "Had one!" this battle.
  await realTap(page.getByTestId('battle-item'));
  await expect(brew).toHaveAttribute('data-state', 'used');
  await realTap(page.getByTestId('battle-item-back'));
  expect(errors).toEqual([]);
});

test('a full team at 375 px: Heart Charm, potions and Swap share the first line, all in view', async ({
  browser,
}) => {
  test.setTimeout(240_000); // a map build and a battle; CI renders in software
  const page = await newPlayer(browser, uniqueName('fullteam'));
  // The smallest phone the game lays out for (iPhone SE), whatever the project's device.
  await page.setViewportSize({ width: 375, height: 667 });
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Team Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;
  // Two more squishies make a full team of three (BATTLE_RULES.teamSize).
  for (const speciesId of ['emberbun', 'thistlepip']) {
    expect(
      (await api(page, 'POST', `/maps/${mapId}/dev/squishies`, { speciesId, level: 3 })).status,
    ).toBe(201);
  }
  await realTap(await trayButton(page, 'battle-dev-fight'));
  await expect(page.getByTestId('battle-hud')).toBeVisible();
  await settled(page);

  const sheet = (await page.getByTestId('battle-sheet').boundingBox())!;
  const boxes = await Promise.all(
    ['battle-capture', 'battle-item', 'battle-swap'].map(
      async (id) => (await page.getByTestId(id).boundingBox())!,
    ),
  );
  for (const box of boxes) {
    // Inside the sheet (it clips what overflows), and on the same line.
    expect(box.y + box.height).toBeLessThanOrEqual(sheet.y + sheet.height + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(375 + 0.5);
    expect(Math.abs(box.y - boxes[0]!.y)).toBeLessThan(1);
    // A 44 pt target both ways (style guide §3), the compact 🧪 included.
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expectRoomyLabels(page, '.battle-button');

  // One Swap for the whole bench: it asks who comes out.
  await realTap(page.getByTestId('battle-swap'));
  await expect(page.getByTestId('battle-swap-pick')).toHaveCount(2);
  await expectRoomyLabels(page, '.battle-button, .battle-ask');
  await realTap(page.getByTestId('battle-swap-back'));
  await expect(page.getByTestId('battle-swap')).toBeVisible();
});
