import { expect, test, type Page } from '@playwright/test';
import { newPlayer } from './players.js';

/** True while a screen holds automatic updates (dev hook, src/pwa/update-hold.ts). */
const updatesHeld = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __heartpatch?: { updatesHeld?(): boolean } }
      ).__heartpatch?.updatesHeld?.() ?? null,
  );

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

  // Both see the patch.
  await friendLobby.getByRole('button', { name: 'Check again' }).tap();
  await friendLobby.getByRole('button', { name: /Spooky Glade/ }).tap();
  await expect(friendLobby.getByTestId('lobby-members')).toContainText(ownerName);
  await expect(friendLobby.getByTestId('lobby-members')).toContainText(`${friendName} (you)`);

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
