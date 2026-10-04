import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName } from './players.js';

// Keeper milestones (#44): finish the tutorial, celebrate The First Patch, see
// it and its prize on the Milestones screen, and wear its title. Asserts on
// the dev hook and test ids, never on pixels. The server counts patch play
// (milestones.test.ts); this covers the player's side, lean.

interface MilestonesCardDebug {
  open: boolean;
  loaded: boolean;
  tracks: string[];
  earned: Record<string, number>;
  titles: string[];
  equippedTitleId: string | null;
}

const tutorial = (page: Page) =>
  hook<{ stepId: string | null; status: string | null }>(page, 'tutorial');
const milestones = async (page: Page) =>
  (await hook<{ milestones: MilestonesCardDebug }>(page, 'wardrobe'))?.milestones ?? null;

test('earn The First Patch, celebrate it, then see it and wear its title', async ({ browser }) => {
  test.setTimeout(120_000); // draws the Glade; CI renders in software
  const page = await newPlayer(browser, uniqueName('mile'));
  const lobby = page.getByTestId('lobby');

  // Through the Glade quickly: the dev route jumps to graduation.
  await lobby.getByTestId('tutorial-start').tap();
  await expect.poll(() => tutorial(page).then((t) => t?.stepId)).toBe('welcome');
  const { status } = await api(page, 'POST', '/tutorial/dev/step', { stepId: 'graduation' });
  expect(status).toBe(200);
  await expect.poll(() => tutorial(page).then((t) => t?.stepId)).toBe('graduation');
  const bubble = page.getByTestId('tutorial-bubble');
  await bubble.getByRole('button', { name: 'Next' }).tap();
  const choices = page.locator('[data-tutorial-target="graduation-choices"]');
  await choices.getByRole('button', { name: 'Make a patch' }).tap();
  await expect.poll(() => tutorial(page).then((t) => t?.status)).toBe('completed');

  // The milestone consumer grants it a moment later, and the party starts.
  const party = page.getByTestId('milestone-card');
  await expect(party).toBeVisible({ timeout: 20_000 });
  await expect(party.getByTestId('milestone-name')).toHaveText('The First Patch');
  await expect(party.getByTestId('milestone-title')).toHaveText("“Sprout's Friend”");
  await expect(party.getByTestId('milestone-prize')).toContainText('20 Patch Coins');
  await party.getByTestId('milestone-yay').tap();
  await expect(party).toBeHidden();

  // The prize arrived: 20 Patch Coins on the patch list.
  await lobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await expect(lobby.getByTestId('lobby-coins')).toContainText('20');

  // The Milestones screen, from the Wardrobe.
  await lobby.getByTestId('wardrobe-open').tap();
  await page.getByTestId('wardrobe-milestones').tap();
  const card = page.getByTestId('milestones');
  await expect(card).toBeVisible();
  await expect.poll(() => milestones(page).then((m) => m?.loaded)).toBe(true);
  const shown = await milestones(page);
  expect(shown?.earned['first-patch']).toBe(1);
  expect(shown?.earned['territory']).toBe(0);
  // Secrets are "???" until found.
  expect(shown?.tracks.filter((t) => t === '???').length).toBeGreaterThan(0);
  await expect(card.locator('[data-track="???"]').first()).toContainText('???');
  await expect(card.locator('[data-track="first-patch"]')).toContainText('All done!');

  // Wear the title on the profile card.
  await expect(card.getByTestId('milestones-worn')).toHaveText('No title yet');
  await card.getByTestId('milestones-pick-title').tap();
  await card.locator('[data-title="sprouts-friend"]').tap();
  await expect(card.getByTestId('milestones-worn')).toHaveText("Sprout's Friend");
  expect((await milestones(page))?.equippedTitleId).toBe('sprouts-friend');

  // Back to the wardrobe card; it's the same Keeper above.
  await card.getByTestId('milestones-back').tap();
  await expect(card).toBeHidden();
  await expect(page.getByTestId('wardrobe-items')).toBeVisible();
});
