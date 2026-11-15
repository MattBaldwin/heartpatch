import { expect, test, type Page } from '@playwright/test';
import { stubBossFight, type BossStubOptions } from './boss-stub.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap } from './touch.js';
import { trayButton } from './trays.js';

/**
 * A mini-boss fight on the battle screen (#190, 190e; owner-approved arena A,
 * picker A1 and the befriend moment), on iPhone and iPad sizes: three
 * squishies against one big boss, a move picked for each in turn, the round
 * played out, the win's bundle, two asks ("Not yet!", then a new friend), and
 * a duplicate that never joins. The boss fight itself is stood in for by
 * boss-stub.ts (no boss visits yet, #234); the app around it is real.
 */

interface BattleDebug {
  status: string;
  pending: number;
  waiting: boolean;
  scene: { squishies: number } | null;
  boss: {
    picking: number | null;
    picks: Record<string, string>;
    asks: number;
    misses: number;
  } | null;
}

const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');

async function bossFight(page: Page, options: BossStubOptions = {}) {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Stomp Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  // A team of three: the starter and two friends from the dev grant.
  for (let i = 0; i < 2; i++) {
    await realTap(await trayButton(page, 'battle-dev-grant'));
    await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  }
  const stub = await stubBossFight(page, options);
  await realTap(await trayButton(page, 'battle-dev-fight'));
  await expect(page.getByTestId('boss-plate')).toBeVisible({ timeout: 30_000 });
  return stub;
}

async function playRound(page: Page): Promise<void> {
  const picker = page.getByTestId('boss-picker');
  await expect(picker).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('boss-pick-header')).toBeVisible();
    await realTap(picker.getByTestId('boss-move').first());
  }
  await expect(picker).toContainText("Everyone's ready!");
  await realTap(page.getByTestId('boss-go'));
}

test.describe('a mini-boss fight (#190)', () => {
  test.describe.configure({ timeout: 180_000 });
  test('won and befriended: three squishies, the picker, the bundle, two asks', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { befriend: ['not-yet', 'joined'] });

    // Arena A: one boss plate, three slim plates, four squishies drawn.
    await expect(page.getByTestId('boss-friends').locator('.boss-friend')).toHaveCount(3);
    await expect(page.getByTestId('boss-plate')).toContainText('Lv');
    await expect(page.getByTestId('boss-tries')).toHaveText('🍀 2 tries left today');
    await expect(page.getByTestId('boss-until')).toContainText('here until');
    await expect.poll(async () => (await battleState(page))?.scene?.squishies).toBe(4);
    // The 1-v-1 pills step aside.
    await expect(page.getByTestId('battle-plate-mine')).toBeHidden();

    // Picker A1: the first squishy picks first; a tap on its chip goes back.
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(0);
    await realTap(page.getByTestId('boss-move').first());
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(1);
    await realTap(page.getByTestId('boss-step-0'));
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(0);
    await playRound(page);

    // One `team` round went out: a pick per squishy, no aiming.
    await expect.poll(() => stub.rounds.length).toBe(1);
    expect(stub.rounds[0]).toMatchObject({ type: 'team' });
    expect((stub.rounds[0]!.picks as unknown[]).map((p) => (p as { slot: number }).slot)).toEqual([
      0, 1, 2,
    ]);

    // The win: the bundle, then the ask.
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('You did it! 🎉');
    await expect(card).toContainText('In your bag: 3 Heart Charms');
    await expect(card.getByTestId('boss-befriend-ask')).toContainText('to be your friend? 💗💗💗');
    const ask = card.getByTestId('boss-ask');
    await expect(ask).toHaveText('Give 3 Heart Charms 💗');
    await expect(ask).toBeEnabled();

    // "Not yet!": one warmth heart, then ask again.
    await realTap(ask);
    await expect(card.getByTestId('boss-not-yet')).toContainText('likes you a little more now.');
    await expect(card.getByTestId('boss-warmth')).toHaveAttribute('data-lit', '1');
    await expect(card.getByTestId('boss-ask')).toHaveText('Ask again (3 💗)');
    await realTap(card.getByTestId('boss-ask'));
    await expect(card.getByTestId('boss-befriend-joined')).toContainText('joined your patch! 💗');

    // Asks 1 then 2, each with its own key.
    expect(stub.asks.map((a) => a.body.ask)).toEqual([1, 2]);
    expect(stub.asks.every((a) => a.key && a.key.length > 8)).toBe(true);
    expect(stub.asks[0]!.key).not.toBe(stub.asks[1]!.key);

    await realTap(page.getByTestId('battle-done'));
    await expect(page.getByTestId('battle-result')).toBeHidden();
  });

  test('a duplicate never joins: no ask, no charms', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { winState: 'have-one' });
    await playRound(page);
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByTestId('boss-befriend-have-one')).toContainText('You already have a');
    await expect(card.getByTestId('boss-ask')).toHaveCount(0);
    expect(stub.asks).toHaveLength(0);
  });
});
