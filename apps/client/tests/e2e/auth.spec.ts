import { expect, test } from '@playwright/test';
import { savedCode, TEST_PASSWORD } from './players.js';

// Signup needs the family code the dev server was started with (playwright.config.ts).
const signupCode = process.env['HP_SIGNUP_CODE'] ?? '';

test('signs up, logs out and logs back in', async ({ page }, testInfo) => {
  const username = `e2e_${Date.now().toString(36)}${String(testInfo.workerIndex)}`;
  const password = TEST_PASSWORD;

  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();

  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family or invite code').fill(signupCode);
  await overlay.getByLabel('Pick a name').fill(username);
  await overlay.getByLabel('Pick a password').fill(password);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();

  const code = overlay.getByTestId('auth-recovery-code');
  await expect(code).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await savedCode(overlay);

  const chip = page.getByTestId('auth-user');
  await expect(chip).toHaveText(`Hi, ${username}!`);
  await expect(overlay).toBeHidden();

  // Still logged in after a reload (session cookie).
  await page.reload();
  await expect(chip).toHaveText(`Hi, ${username}!`);

  await page.getByRole('button', { name: 'Log out' }).tap();
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();

  // This device remembers the name (#197): tap it, then the password.
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(overlay.getByRole('button', { name: username })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await overlay.getByLabel(`Password for ${username}`).fill('not-my-password');
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(overlay.getByTestId('auth-error')).toHaveText(/don't match/);

  await overlay.getByLabel(`Password for ${username}`).fill(password);
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(chip).toHaveText(`Hi, ${username}!`);
});

test('"Not you?" forgets the names, and "Forgot your name?" explains the ways back (#197)', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000); // a reload rebuilds the scene; CI renders in software
  const username = `nb_${Date.now().toString(36)}${String(testInfo.workerIndex)}`;
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family or invite code').fill(signupCode);
  await overlay.getByLabel('Pick a name').fill(username);
  await overlay.getByLabel('Pick a password').fill(TEST_PASSWORD);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await savedCode(overlay);
  await expect(page.getByTestId('auth-user')).toHaveText(`Hi, ${username}!`);
  await page.getByRole('button', { name: 'Log out' }).tap();

  // "Someone else" types a name, as before; "Back to log in" shows the names again.
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await overlay.getByTestId('auth-someone-else').tap();
  await expect(overlay.getByLabel('Name')).toBeVisible();
  await overlay.getByTestId('auth-to-recover').tap();
  await overlay.getByTestId('auth-to-login').tap();
  await expect(overlay.getByTestId('auth-remembered-name')).toHaveText([username]);

  // Remembered across a reload.
  await page.reload();
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(overlay.getByTestId('auth-remembered-name')).toHaveText([username]);

  // "Not you?" asks first; "Keep them" changes nothing.
  await overlay.getByTestId('auth-not-you').tap();
  await expect(overlay.getByRole('heading', { name: 'Forget these names?' })).toBeVisible();
  await overlay.getByRole('button', { name: 'Keep them' }).tap();
  await expect(overlay.getByTestId('auth-remembered-name')).toHaveCount(1);
  await overlay.getByTestId('auth-not-you').tap();
  await overlay.getByRole('button', { name: 'Forget them' }).tap();
  await expect(overlay.getByLabel('Name')).toBeVisible();
  await expect(overlay.getByTestId('auth-remembered-name')).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('heartpatch.rememberedNames.v1')),
  ).toBeNull();

  // The help sheet only explains: there's nothing to type a guess into.
  await overlay.getByTestId('auth-forgot-name').tap();
  const sheet = overlay.getByTestId('auth-forgot-name-sheet');
  await expect(sheet).toContainText('Use the device you played on');
  await expect(sheet).toContainText('Ask your helper or patch owner');
  await expect(sheet.getByRole('textbox')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Got it' }).tap();
  await expect(sheet).toBeHidden();
});

test('explains form problems in kid-friendly words', async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family or invite code').fill('anything');
  await overlay.getByLabel('Pick a name').fill('ab');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await expect(overlay.getByTestId('auth-error')).toHaveText(/Names need at least 3/);
  await expect(overlay.getByLabel('Pick a name')).toBeFocused();
});

test('the welcome card shows no keyboard focus ring before any key is pressed (#158)', async ({
  page,
}) => {
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  const login = overlay.getByRole('button', { name: 'Log in' });
  await expect(login).toBeVisible();
  // Focus starts on the card (screen readers read from its title), not a button.
  await expect(overlay.getByRole('dialog')).toBeFocused();
  expect(await login.evaluate((b) => b.matches(':focus-visible'))).toBe(false);
  expect(
    await page.evaluate(() => document.querySelector(':focus-visible')?.matches('button') ?? false),
  ).toBe(false);
});
