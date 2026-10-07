import { expect, test } from '@playwright/test';
import { newPlayer, savedCode } from './players.js';

// Grown-up helpers (#197): the kid asks at sign up, the grown-up says yes,
// then resets the kid's forgotten password; the kid makes a new recovery code.
test('a grown-up helper helps a kid back in', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now().toString(36)}${String(testInfo.workerIndex)}`;
  const grownName = `mom_${suffix}`;
  const kidName = `pip_${suffix}`;

  // Helpers are grown-ups (18+, owner decision 2026-10-07).
  const grown = await newPlayer(browser, grownName, undefined, { birthYear: '1985' });
  const grownLobby = grown.getByTestId('lobby');
  await grownLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await grownLobby.getByLabel('Patch name').fill('Cozy Corner');
  await grownLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await grownLobby.getByTestId('lobby-invite-code').textContent()) ?? '';

  // The kid signs up with the invite and asks the grown-up behind it.
  const kid = await newPlayer(browser, kidName, code, { helper: 'ask' });
  const kidLobby = kid.getByTestId('lobby');
  await kidLobby.getByTestId('lobby-settings').tap();
  const myHelpers = kidLobby.getByTestId('account-helpers');
  await expect(myHelpers).toContainText(grownName);
  await expect(myHelpers).toContainText('Waiting');

  // The grown-up says yes on the patch list.
  await grownLobby.getByRole('button', { name: 'Back to my patches' }).tap();
  const asks = grownLobby.getByTestId('account-asks');
  await expect(asks).toContainText(`${kidName} wants you as their helper`);
  await asks.getByRole('button', { name: 'Say yes' }).tap();
  await expect(asks).toBeHidden();

  // …and later resets the kid's password from Settings.
  await grownLobby.getByTestId('lobby-settings').tap();
  const helping = grownLobby.getByTestId('account-helping');
  await helping.getByRole('button', { name: `Help ${kidName}` }).tap();
  const card = grown.getByTestId('account-overlay');
  await expect(card.getByTestId('account-their-name')).toHaveText(kidName);
  await card.getByTestId('account-reset').tap();
  await card.getByRole('button', { name: 'Reset', exact: true }).tap();
  const temporary = (await card.getByTestId('account-temp-password').textContent()) ?? '';
  expect(temporary).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(card.getByTestId('account-recovery-code')).toHaveText(
    /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
  );
  await card.getByRole('button', { name: 'Done' }).tap();
  await expect(card).toBeHidden();

  // The kid was logged out everywhere; their device remembers their name.
  await kid.reload();
  const overlay = kid.getByTestId('auth-overlay');
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await overlay.getByLabel(`Password for ${kidName}`).fill(temporary);
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(kid.getByTestId('auth-user')).toHaveText(`Hi, ${kidName}!`);

  // Settings: the helper is linked now, and a new recovery code needs the password.
  await kidLobby.getByTestId('lobby-settings').tap();
  await expect(myHelpers).toContainText('Helper');
  await kidLobby.getByTestId('account-new-code').tap();
  const kidCard = kid.getByTestId('account-overlay');
  await kidCard.getByLabel('Your password').fill('not-my-password');
  await kidCard.getByRole('button', { name: 'Make new code' }).tap();
  await expect(kidCard.getByTestId('account-error')).toHaveText(/isn't right/);
  await kidCard.getByLabel('Your password').fill(temporary);
  await kidCard.getByRole('button', { name: 'Make new code' }).tap();
  await expect(kidCard.getByTestId('auth-recovery-code')).toHaveText(
    /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
  );
  await savedCode(kidCard, 'Done');
  await expect(kidCard).toBeHidden();

  await grown.context().close();
  await kid.context().close();
});
