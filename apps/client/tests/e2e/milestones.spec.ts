import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
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

  // The milestone consumer grants it a moment later; the party waits behind
  // the "Make a patch" form graduation opened (one card at a time, #129) and
  // starts once the player leaves it.
  await lobby.getByRole('button', { name: 'Back to my patches' }).tap();
  const party = page.getByTestId('milestone-card');
  await expect(party).toBeVisible({ timeout: 20_000 });
  await expect(party.getByTestId('milestone-name')).toHaveText('The First Patch');
  await expect(party.getByTestId('milestone-title')).toHaveText("“Sprout's Friend”");
  await expect(party.getByTestId('milestone-prize')).toContainText('20 Patch Coins');
  await party.getByTestId('milestone-yay').tap();
  await expect(party).toBeHidden();

  // The prize arrived: 20 Patch Coins on the patch list.
  await expect(lobby.getByTestId('lobby-coins')).toContainText('20');

  // The Milestones screen, from the Wardrobe's shortcut (its home is the Keeper menu, #731).
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
  await expect(card.locator('[data-medal="sprouts-friend"]')).toHaveAttribute(
    'data-earned',
    'true',
  );

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

// The line under the cards ("Big goals, each with a prize!") sits in its own
// grid row. It once shared a row with the list, so with the long track list it
// overlapped the last card's heading. Measured as boxes, never pixels.
const SHEET_VIEWPORTS = [
  { name: 'iPhone SE portrait', width: 320, height: 568 },
  { name: 'iPhone portrait', width: 393, height: 852 },
  { name: 'iPhone landscape', width: 844, height: 390 },
  { name: 'iPad portrait', width: 834, height: 1194 },
] as const;

test('the Milestones line sits below the last card, never over it', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('foot'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByTestId('wardrobe-open').tap();
  await page.getByTestId('wardrobe-milestones').tap();
  const card = page.getByTestId('milestones');
  await expect(card).toBeVisible();
  await expect.poll(() => milestones(page).then((m) => m?.loaded)).toBe(true);
  // The Christmas track (#37) is part of the list that made it long.
  await expect(card.locator('[data-track="christmas"]')).toHaveCount(1);

  for (const vp of SHEET_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const list = card.getByTestId('milestones-list');
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const note = card.getByTestId('milestones-note');
    await expect(note).toHaveText('Big goals, each with a prize!');
    const problems = await card.evaluate((root) => {
      const noteBox = root
        .querySelector('[data-testid="milestones-note"]')
        ?.getBoundingClientRect();
      const listBox = root
        .querySelector('[data-testid="milestones-list"]')
        ?.getBoundingClientRect();
      if (!noteBox || !listBox) return ['missing note or list'];
      const out: string[] = [];
      if (listBox.bottom > noteBox.top + 0.5) {
        out.push(`list runs past the note (${String(listBox.bottom)} > ${String(noteBox.top)})`);
      }
      for (const head of root.querySelectorAll('.milestones-track-head')) {
        const h = head.getBoundingClientRect();
        const apart = h.bottom <= noteBox.top + 0.5 || h.top >= noteBox.bottom - 0.5;
        const sideways = h.right <= noteBox.left || h.left >= noteBox.right;
        if (!apart && !sideways) out.push(`a card heading overlaps the note`);
      }
      return out;
    });
    expect(problems, vp.name).toEqual([]);
    // The list still scrolls to its last card.
    const last = await list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    expect(Math.abs(last), vp.name).toBeLessThan(2);
  }
});
