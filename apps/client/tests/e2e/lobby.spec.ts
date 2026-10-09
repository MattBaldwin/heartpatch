import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/** True while a screen holds automatic updates (dev hook, src/pwa/update-hold.ts). */
const updatesHeld = (page: Page) => hook<boolean>(page, 'updatesHeld');

test('owner makes a patch, a friend joins with the code, owner approves and resets', async ({
  browser,
}, testInfo) => {
  // Two signups, each through the Keeper picker's 3D preview (#42); CI renders
  // in software. A pass takes about a minute on iPad WebKit (58.6 s on #224's
  // CI), and a group's first tests also pay for the first shader compiles.
  test.setTimeout(120_000);
  const suffix = `${Date.now().toString(36)}${String(testInfo.workerIndex)}`;
  const ownerName = `own_${suffix}`;
  const friendName = `pal_${suffix}`;

  // The owner makes a patch and gets a code.
  const owner = await newPlayer(browser, ownerName);
  const ownerLobby = owner.getByTestId('lobby');
  await expect(ownerLobby).toContainText('No patches yet');
  await ownerLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await ownerLobby.getByLabel('Patch name').fill('Spooky Glade');
  await ownerLobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(ownerLobby.getByRole('heading', { name: 'Spooky Glade' })).toBeVisible();
  const code = (await ownerLobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // A friend asks to join with it.
  const friend = await newPlayer(browser, friendName);
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code.toLowerCase());
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-notice')).toContainText(`${ownerName} just needs`);
  await expect(friendLobby.getByTestId('lobby-waiting')).toContainText('Spooky Glade');

  // The owner's patch list says someone is waiting (#144), and the owner says yes.
  await ownerLobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await expect(ownerLobby.getByTestId('lobby-map-asking')).toHaveText('1 wants to join!');
  await ownerLobby.getByRole('button', { name: /Spooky Glade/ }).tap();
  const requests = ownerLobby.getByTestId('lobby-requests');
  await expect(requests).toContainText(`${friendName} wants to join`);
  await requests.getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-notice')).toContainText(`${friendName} joined`);
  await expect(ownerLobby.getByTestId('lobby-members')).toContainText(friendName);
  // A new patch seats 6 (#318): two Keepers with their map icons, four open homes.
  await expect(ownerLobby.getByRole('heading', { name: 'Keepers (2/6)' })).toBeVisible();
  await expect(ownerLobby.getByTestId('lobby-open-seat')).toHaveCount(4);
  await expect(ownerLobby.getByTestId('lobby-members').locator('.slot-icon')).toHaveCount(2);

  // Both see the patch: the friend's waiting row turns into it by itself (#145).
  await expect(friendLobby.getByTestId('lobby-waiting')).toHaveCount(0, { timeout: 15_000 });
  await expect(friendLobby.getByTestId('lobby-notice')).toHaveText("Yay! You're in Spooky Glade!");
  await friendLobby.getByRole('button', { name: /Spooky Glade/ }).tap();
  await expect(friendLobby.getByTestId('lobby-members')).toContainText(ownerName);
  await expect(friendLobby.getByTestId('lobby-members')).toContainText(`${friendName} (you)`);

  // The challenge mode picked says so (#146).
  await expect(
    ownerLobby.getByRole('radio', { name: /^Gentle/ }).locator('.lobby-choice-picked'),
  ).toHaveText('✓ Picked');
  await expect(ownerLobby.getByRole('radio', { name: /^Gentle/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // A swipe that starts on "Remove" scrolls the list; it never taps the button (#146).
  const remove = ownerLobby
    .getByTestId('lobby-members')
    .getByRole('listitem')
    .filter({ hasText: friendName })
    .getByRole('button', { name: 'Remove' });
  await remove.evaluate((button) => {
    const panel = button.closest<HTMLElement>('.lobby')!;
    const box = button.getBoundingClientRect();
    const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    const pointer = { ...at, pointerType: 'touch', isPrimary: true, bubbles: true };
    button.dispatchEvent(new PointerEvent('pointerdown', pointer));
    panel.scrollTop += 120;
    const end = { ...at, clientY: at.clientY - 120 };
    button.dispatchEvent(new PointerEvent('pointerup', { ...pointer, ...end }));
    button.dispatchEvent(new MouseEvent('click', { ...end, detail: 1, bubbles: true }));
  });
  await expect(ownerLobby.getByRole('heading', { name: 'Spooky Glade' })).toBeVisible();
  await expect(ownerLobby.getByRole('heading', { name: /^Remove/ })).toHaveCount(0);

  // The owner resets the friend's password; the friend logs in with the new one.
  const friendRow = ownerLobby.getByTestId('lobby-members').getByRole('listitem').filter({
    hasText: friendName,
  });
  await friendRow.getByRole('button', { name: 'Reset password' }).tap();
  await ownerLobby.getByRole('button', { name: 'Reset', exact: true }).tap();
  const temporary = (await ownerLobby.getByTestId('lobby-temp-password').textContent()) ?? '';
  expect(temporary).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(ownerLobby.getByTestId('lobby-recovery-code')).toHaveText(
    /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
  );
  // Shown once: no automatic update may reload it away (#47).
  expect(await updatesHeld(owner)).toBe(true);
  await ownerLobby.getByRole('button', { name: 'Done' }).tap();
  expect(await updatesHeld(owner)).toBe(false);

  await friend.reload();
  const overlay = friend.getByTestId('auth-overlay');
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  // The friend's device remembers their name (#197).
  await overlay.getByRole('button', { name: friendName }).tap();
  await overlay.getByLabel(`Password for ${friendName}`).fill(temporary);
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(friendLobby.getByRole('button', { name: /Spooky Glade/ })).toBeVisible();

  await owner.context().close();
  await friend.context().close();
});

test('a reload lands back on the patch the player was on (#160)', async ({ browser }) => {
  test.setTimeout(120_000); // a map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('back'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Return Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.getByTestId('map-hud')).toContainText('Return Patch', { timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId('map-hud')).toContainText('Return Patch', { timeout: 30_000 });
  await expect(lobby).toBeHidden();
  await page.context().close();
});

test('a new family signs up with a patch invite and lands in the join queue (#195)', async ({
  browser,
}, testInfo) => {
  // Two signups, each through the Keeper picker's 3D preview (#42); CI renders in software.
  test.setTimeout(90_000);
  const suffix = `${Date.now().toString(36)}${String(testInfo.workerIndex)}`;
  const ownerName = `host_${suffix}`;
  const kidName = `newfam_${suffix}`;

  const owner = await newPlayer(browser, ownerName);
  const ownerLobby = owner.getByTestId('lobby');
  await ownerLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await ownerLobby.getByLabel('Patch name').fill('Cozy Corner');
  await ownerLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await ownerLobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  await expect(ownerLobby.getByTestId('lobby-invite')).toContainText('New families can sign up');

  // The owner makes a family code for another family: shown once, then listed.
  const familyCodes = ownerLobby.getByTestId('lobby-family-codes');
  await familyCodes.getByLabel("Who's it for?").fill('Lee family');
  await familyCodes.getByRole('button', { name: 'Make a family code' }).tap();
  await expect(ownerLobby.getByTestId('lobby-family-code')).toHaveText(
    /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
  );
  expect(await updatesHeld(owner)).toBe(true);
  await ownerLobby.getByRole('button', { name: 'All done!' }).tap();
  await expect(familyCodes.getByRole('listitem')).toContainText(['Lee family']);
  await expect(familyCodes).toContainText('0 of 8 used');

  // A brand-new family types the patch invite on the sign-up screen: one code
  // makes the account and asks to join.
  const kid = await newPlayer(browser, kidName, code);
  const kidLobby = kid.getByTestId('lobby');
  await expect(kidLobby.getByTestId('lobby-waiting')).toContainText('Cozy Corner');
  await expect(kidLobby.getByTestId('lobby-waiting')).toContainText(`Waiting for ${ownerName}`);

  // The owner sees them asking and says yes.
  await ownerLobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await expect(ownerLobby.getByTestId('lobby-map-asking')).toHaveText('1 wants to join!');
  await ownerLobby.getByRole('button', { name: /Cozy Corner/ }).tap();
  const requests = ownerLobby.getByTestId('lobby-requests');
  await expect(requests).toContainText(`${kidName} wants to join`);
  await requests.getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-members')).toContainText(kidName);
  await expect(kidLobby.getByTestId('lobby-waiting')).toHaveCount(0, { timeout: 15_000 });

  await owner.context().close();
  await kid.context().close();
});

test('looking around the world has a big way back to the patch list (#212)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const page = await newPlayer(browser, uniqueName('peek'));
  const lobby = page.getByTestId('lobby');
  const back = page.getByTestId('lobby-back');
  await expect(back).toBeHidden();

  await lobby.getByRole('button', { name: 'Look around the world' }).tap();
  await expect(lobby).toBeHidden();
  await expect(back).toBeVisible();
  await expect(back).toHaveText('← Back to my patches');
  const box = (await back.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(48);
  // Bottom centre, for a thumb, fully on screen.
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await back.tap();
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  await expect(back).toBeHidden();

  // Over an open patch there's no pill: the patch is what you're looking at.
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Peek Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(back).toBeHidden();
  await page.getByTestId('lobby-open').tap();
  await lobby.getByRole('button', { name: 'Look around the world' }).tap();
  await expect(lobby).toBeHidden();
  await expect(back).toBeHidden();

  // Home can't open (offline): the list says why over the still-open patch,
  // and looking around from there goes back to the patch, still no pill.
  await page.route('**/api/v1/maps/*/home', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'INTERNAL', message: 'Oops!' } } }),
  );
  await (await trayButton(page, 'home-open')).tap();
  await expect(lobby).toBeVisible();
  await lobby.getByRole('button', { name: 'Look around the world' }).tap();
  await expect(lobby).toBeHidden();
  await expect(back).toBeHidden();
  await page.context().close();
});
