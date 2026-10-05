import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/** True while a screen holds automatic updates (dev hook, src/pwa/update-hold.ts). */
const updatesHeld = (page: Page) => hook<boolean>(page, 'updatesHeld');

test('owner makes a patch, a friend joins with the code, owner approves and resets', async ({
  browser,
}, testInfo) => {
  // Two signups, each through the Keeper picker's 3D preview (#42); CI renders in software.
  test.setTimeout(90_000);
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

  // The owner sees the request and says yes.
  await ownerLobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await ownerLobby.getByRole('button', { name: /Spooky Glade/ }).tap();
  const requests = ownerLobby.getByTestId('lobby-requests');
  await expect(requests).toContainText(`${friendName} wants to join`);
  await requests.getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-notice')).toContainText(`${friendName} joined`);
  await expect(ownerLobby.getByTestId('lobby-members')).toContainText(friendName);

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
  await overlay.getByLabel('Name').fill(friendName);
  await overlay.getByLabel('Password').fill(temporary);
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
