import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { api, hook, waitForLiveMap } from './dev-hook.js';
import { settled } from './layout.js';
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

/** An iPhone SE on its side, where the Keeper's "Me" button met the ✕. */
const SE_SIDEWAYS = { width: 667, height: 375 };

/**
 * The open sheet's ✕ is the top thing at its own middle and shares no area
 * with the Keeper's "Me" button (or the plain chip off the trays) when
 * that's on screen, then shuts the sheet with a tap.
 */
async function closeClear(page: Page): Promise<void> {
  const sheet = page.getByTestId('next-up-sheet');
  await expect(sheet).toBeVisible();
  await settled(page);
  const probe = await page.evaluate(() => {
    const close = document.querySelector('[data-testid="next-up-close"]')!;
    const c = close.getBoundingClientRect();
    const top = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    const hits = [...document.querySelectorAll('.auth-chip, .auth-chip-toggle')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .filter((r) => c.left < r.right && r.left < c.right && c.top < r.bottom && r.top < c.bottom)
      .map((r) => [r.left, r.top, r.right, r.bottom].map(Math.round));
    return {
      onTop: top !== null && close.contains(top),
      hits,
      inView: c.top >= 0 && c.left >= 0 && c.right <= window.innerWidth,
    };
  });
  expect(probe.hits, 'the Keeper button is over the ✕').toEqual([]);
  expect(probe.onTop, 'something covers the ✕').toBe(true);
  expect(probe.inView, 'the ✕ is off screen').toBe(true);
  await sheet.getByTestId('next-up-close').tap();
  await expect(sheet).toBeHidden();
  // The Keeper button comes back once the sheet shuts.
  await expect(page.locator('.auth-chip')).toBeVisible();
}

/** Opens the sheet from the chip and checks its ✕ upright and on a phone on its side. */
async function closeClearBothWays(page: Page): Promise<void> {
  const upright = page.viewportSize()!;
  const chip = page.getByTestId('next-up-chip');
  for (const size of [upright, SE_SIDEWAYS]) {
    await page.setViewportSize(size);
    await expect(chip).toBeVisible();
    await chip.tap();
    await closeClear(page);
  }
  await page.setViewportSize(upright);
}

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
  // Sprout keeps "Ooh, a goal!" for a real goal, not the solo card.
  expect((await nextUp(owner))?.sprout).toBe(false);
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
  // Its ✕ is clear of the Keeper's "Me" button, upright and on its side.
  await closeClearBothWays(owner);

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
  const friend = await newPlayer(browser, uniqueName('pal'));
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code);
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-waiting')).toBeVisible();
  // The owner says yes while still on the patch (the lobby's Yes! button
  // calls the same route): the chip changes by itself, with no revisit.
  const mapId = (await nextUp(owner))?.mapId ?? '';
  const detail = await api<{ map: { admin: { requests: { id: string }[] } | null } }>(
    owner,
    'GET',
    `/maps/${mapId}`,
  );
  const requestId = detail.body.map.admin?.requests[0]?.id ?? '';
  expect(requestId).not.toBe('');
  const yes = await api(owner, 'POST', `/maps/${mapId}/requests/${requestId}/approve`);
  expect(yes.status).toBeLessThan(300);
  await friend.context().close();
  await expect.poll(() => nextUp(owner).then((n) => n?.state), { timeout: 20_000 }).toBe('goals');
  await expect(chip).toBeVisible();
  await expect(chip.getByTestId('next-up-kicker')).toContainText('Next up');
  // Now there's a real goal: Sprout says it once (owner decision 4).
  await expect.poll(() => nextUp(owner).then((n) => n?.sprout), { timeout: 15_000 }).toBe(true);
  await expect(owner.getByTestId('next-up-sprout')).toHaveText('Ooh, a goal!');
  // Map labels step aside for Sprout's line and the chip, as for the night's chips.
  await settled(owner);
  const under = await owner.evaluate(() => {
    const covers = ['next-up-sprout', 'next-up-chip'].map((id) =>
      document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect(),
    );
    return [...document.querySelectorAll<HTMLElement>('.post-flag')]
      .filter((f) => !f.hidden && f.offsetWidth > 0)
      .filter((f) => {
        const r = f.getBoundingClientRect();
        return covers.some(
          (c) => c.left < r.right && r.left < c.right && c.top < r.bottom && r.top < c.bottom,
        );
      })
      .map((f) => f.textContent);
  });
  expect(under, 'a map label under Sprout or the chip').toEqual([]);
  const goals = (await nextUp(owner))?.goals ?? [];
  expect(goals.length).toBe(3);
  await chip.tap();
  await expect(sheet.getByTestId('next-up-goal')).toHaveCount(3);
  await expect(sheet.getByTestId('next-up-solo')).toHaveCount(0);
  await sheet.getByTestId('next-up-close').tap();
  await expect(sheet).toBeHidden();
  await closeClearBothWays(owner);

  // One Goals row in the Adventure tray opens the same sheet (owner decision 2).
  // Under 740 px tall it gives way (next-up.css), and Playwright's iPhone 15
  // is Safari's 659 px: stand it as the installed app's full 852 px.
  const browserSize = owner.viewportSize()!;
  if (browserSize.height < 740)
    await owner.setViewportSize({ width: browserSize.width, height: 852 });
  await owner.getByTestId('tray-handle-adventure').tap();
  const row = owner.getByTestId('next-up-row');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('next-up-row-sub')).not.toBeEmpty();
  await row.tap();
  await expect(sheet).toBeVisible();
  await expect.poll(() => nextUp(owner).then((n) => n?.sheetOpen)).toBe(true);
  await sheet.getByTestId('next-up-close').tap();
  await expect(sheet).toBeHidden();
  await owner.setViewportSize(browserSize);
});
