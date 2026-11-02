import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { hook, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

// The Next-up chip (#731): a patch that's only you shows the share-your-code
// card; once a friend joins it shows real goals; the chip steps aside for the
// tile panel; and there's none on the Tutorial Glade. Asserts on the dev hook
// and test ids, never on pixels. The selection itself is unit-tested
// (next-up-view.test.ts).

interface NextUpDebug {
  mapId: string | null;
  state: 'none' | 'goals' | 'solo' | 'done';
  goals: string[];
  chipShown: boolean;
  sheetOpen: boolean;
  sprout: boolean;
}

const nextUp = (page: Page) => hook<NextUpDebug>(page, 'nextUp');
const tutorial = (page: Page) =>
  hook<{ stepId: string | null; status: string | null }>(page, 'tutorial');
const trays = (page: Page) => hook<{ visible: boolean }>(page, 'trays');

test('no chip on the Tutorial Glade', async ({ browser }) => {
  test.setTimeout(120_000); // draws the Glade; CI renders in software
  const page = await newPlayer(browser, uniqueName('glade'));
  await page.getByTestId('lobby').getByTestId('tutorial-start').tap();
  await expect.poll(() => tutorial(page).then((t) => t?.stepId)).toBe('welcome');
  await waitForLiveMap(page);
  // The Glade's HUD is up, but the chip and its tray row are not.
  await expect.poll(() => trays(page).then((t) => t?.visible)).toBe(true);
  expect(await nextUp(page)).toMatchObject({ mapId: null, state: 'none', chipShown: false });
  await expect(page.getByTestId('next-up-chip')).toBeHidden();
  await expect(page.getByTestId('next-up-row')).toBeHidden();
});

test('a solo patch shows the share-your-code card, then real goals once a friend joins', async ({
  browser,
}) => {
  // Two players and a map; CI renders in software (map.spec.ts needs 240 s for the same join).
  test.setTimeout(240_000);
  const owner = await newPlayer(browser, uniqueName('nxt'));
  const ownerLobby = owner.getByTestId('lobby');
  await ownerLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await ownerLobby.getByLabel('Patch name').fill('Goal Patch');
  await ownerLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await ownerLobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  expect(code).not.toBe('');
  await visitPatch(ownerLobby);
  await waitForLiveMap(owner);
  // Sprout's first-time hint about the trays comes first; the chip waits behind it.
  await owner.getByTestId('tray-hint-ok').tap();

  // Alone: the chip asks for a friend, and its sheet has the lobby's code.
  await expect.poll(() => nextUp(owner).then((n) => n?.state), { timeout: 20_000 }).toBe('solo');
  const chip = owner.getByTestId('next-up-chip');
  await expect(chip).toBeVisible();
  await expect(chip.getByTestId('next-up-line')).toHaveText('Invite a friend to start');
  // After graduation's patch, Sprout says it once (owner decision 4).
  await expect.poll(() => nextUp(owner).then((n) => n?.sprout), { timeout: 15_000 }).toBe(true);
  await expect(owner.getByTestId('next-up-sprout')).toHaveText('Ooh, a goal!');
  await chip.tap();
  const sheet = owner.getByTestId('next-up-sheet');
  await expect(sheet).toBeVisible();
  await expect(chip).toBeHidden();
  const solo = sheet.getByTestId('next-up-solo');
  await expect(solo).toContainText('Milestones start counting when a friend joins 💛');
  await expect(solo.getByTestId('next-up-code')).toHaveText(code);
  await expect(solo.getByTestId('next-up-code-line')).toContainText(
    'New families can sign up with it too!',
  );
  await sheet.getByTestId('next-up-close').tap();
  await expect(sheet).toBeHidden();
  await expect(chip).toBeVisible();

  // The tile panel owns the bottom middle (owner decision 1): the chip steps aside.
  const box = (await owner.locator('#game').boundingBox())!;
  await tapCanvas(owner, box.width / 2, box.height / 2);
  const panel = owner.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  await expect(chip).toBeHidden();
  expect((await nextUp(owner))?.chipShown).toBe(false);
  await panel.getByRole('button', { name: 'Close' }).tap();
  await expect(panel).toBeHidden();
  await expect(chip).toBeVisible();

  // A friend asks to join and the owner says yes from the lobby.
  const friendName = uniqueName('pal');
  const friend = await newPlayer(browser, friendName);
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code);
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-waiting')).toBeVisible();
  await owner.getByTestId('lobby-open').tap();
  await ownerLobby.getByRole('button', { name: /Goal Patch/ }).tap();
  await ownerLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-notice')).toContainText(`${friendName} joined`);
  await friend.context().close();

  // Back on the patch, it reads again: now milestones count, so real goals.
  await visitPatch(ownerLobby);
  await expect(owner.getByTestId('map-hud')).toContainText('Goal Patch');
  await expect.poll(() => nextUp(owner).then((n) => n?.state), { timeout: 20_000 }).toBe('goals');
  await expect(chip).toBeVisible();
  await expect(chip.getByTestId('next-up-kicker')).toContainText('Next up');
  const goals = (await nextUp(owner))?.goals ?? [];
  expect(goals.length).toBe(3);
  await chip.tap();
  await expect(sheet.getByTestId('next-up-goal')).toHaveCount(3);
  await expect(sheet.getByTestId('next-up-solo')).toHaveCount(0);
  await sheet.getByTestId('next-up-close').tap();

  // One Goals row in the Adventure tray opens the same sheet (owner decision 2).
  await owner.getByTestId('tray-handle-adventure').tap();
  const row = owner.getByTestId('next-up-row');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('next-up-row-sub')).not.toBeEmpty();
  await row.tap();
  await expect(sheet).toBeVisible();
  await expect.poll(() => nextUp(owner).then((n) => n?.sheetOpen)).toBe(true);
  await sheet.getByTestId('next-up-close').tap();
  await expect(sheet).toBeHidden();
});
