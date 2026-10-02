import { expect, test, type Browser, type Page } from '@playwright/test';

// Signup needs the family code the dev server was started with (playwright.config.ts).
const signupCode = process.env['HP_SIGNUP_CODE'] ?? '';
const password = 'squishy-secret';

/** A name nobody has used yet, e.g. `own_lq3x9a0` (usernames are global). */
export function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${String(test.info().workerIndex)}`;
}

/** A new player in their own browser context (own cookies), signed up and in the lobby. */
export async function newPlayer(browser: Browser, name: string): Promise<Page> {
  // The project's device settings (viewport, touch), so tap() works like on an iPhone.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } =
    test.info().project.use;
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
    ...(isMobile ? { isMobile } : {}),
    ...(hasTouch ? { hasTouch } : {}),
    ...(baseURL ? { baseURL } : {}),
  });
  const page = await context.newPage();
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family code').fill(signupCode);
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill(password);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByRole('button', { name: 'I saved it!' }).tap();
  await expect(
    page.getByTestId('lobby').getByRole('heading', { name: 'Your patches' }),
  ).toBeVisible();
  return page;
}
