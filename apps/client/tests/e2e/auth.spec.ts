import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from './players.js';

// Signup needs the family code the dev server was started with (playwright.config.ts).
const signupCode = process.env['HP_SIGNUP_CODE'] ?? '';

test('signs up, logs out and logs back in', async ({ page }, testInfo) => {
  const username = `e2e_${Date.now().toString(36)}${String(testInfo.workerIndex)}`;
  const password = TEST_PASSWORD;

  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();

  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family code').fill(signupCode);
  await overlay.getByLabel('Pick a name').fill(username);
  await overlay.getByLabel('Pick a password').fill(password);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();

  const code = overlay.getByTestId('auth-recovery-code');
  await expect(code).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await overlay.getByRole('button', { name: 'I saved it!' }).tap();

  const chip = page.getByTestId('auth-user');
  await expect(chip).toHaveText(`Hi, ${username}!`);
  await expect(overlay).toBeHidden();

  // Still logged in after a reload (session cookie).
  await page.reload();
  await expect(chip).toHaveText(`Hi, ${username}!`);

  await page.getByRole('button', { name: 'Log out' }).tap();
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();

  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await overlay.getByLabel('Name').fill(username);
  await overlay.getByLabel('Password').fill('not-my-password');
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(overlay.getByTestId('auth-error')).toHaveText(/don't match/);

  await overlay.getByLabel('Password').fill(password);
  await overlay.getByRole('button', { name: 'Log in' }).tap();
  await expect(chip).toHaveText(`Hi, ${username}!`);
});

test('explains form problems in kid-friendly words', async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family code').fill('anything');
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
