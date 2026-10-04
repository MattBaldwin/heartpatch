import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

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
  await pickKeeper(page);
  // Roomy: under a full e2e run the lobby's first fetches can take a while.
  await expect(
    page.getByTestId('lobby').getByRole('heading', { name: 'Your patches' }),
  ).toBeVisible({ timeout: 15_000 });
  return page;
}

/**
 * Marks the opening cinematic (#46) seen for the logged-in account, through
 * the API, so it doesn't play after the Keeper pick. Every spec signs up a
 * new player; only cinematic.spec.ts watches the story. Call it before
 * "That's me!".
 */
export async function skipCinematic(page: Page): Promise<void> {
  const res = await page.request.post('/api/v1/cinematic/seen', {
    headers: { 'x-requested-with': 'heartpatch' },
  });
  expect(res.ok()).toBe(true);
}

/**
 * A new account picks its Keeper right after signup (#42), before the lobby.
 * The opening cinematic that comes next is marked seen first, unless
 * `cinematic` says to let it play.
 */
export async function pickKeeper(
  page: Page,
  base = 'Clover',
  cinematic: 'skip' | 'play' = 'skip',
): Promise<void> {
  if (cinematic === 'skip') await skipCinematic(page);
  const picker = page.getByTestId('keeper-picker');
  await expect(picker.getByRole('heading', { name: 'Pick your Keeper!' })).toBeVisible();
  await picker.getByRole('button', { name: base, exact: true }).tap();
  await picker.getByRole('button', { name: 'That’s me!' }).tap();
  await expect(picker).toBeHidden();
}

/**
 * Taps "Visit patch" in `lobby`. The first visit to a patch someone made or
 * joined asks them to choose a starter before the map (owner decision
 * 2026-10-03), so this picks `starter` when asked.
 */
export async function visitPatch(lobby: Locator, starter = 'Puddlepuff'): Promise<void> {
  const page = lobby.page();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  // The lobby steps aside either for the picker or, with a starter, for the map;
  // the picker opens in the same moment the lobby steps out.
  await expect(lobby).toBeHidden({ timeout: 30_000 });
  if (await page.getByTestId('starter-picker').isVisible()) await pickStarter(page, starter);
}

/** Chooses `name` on the "Choose your friend!" screen. */
export async function pickStarter(page: Page, name = 'Puddlepuff'): Promise<void> {
  const picker = page.getByTestId('starter-picker');
  await expect(picker.getByRole('heading', { name: 'Choose your friend!' })).toBeVisible();
  await picker.getByRole('button', { name: new RegExp(`^${name},`) }).tap();
  await picker.getByRole('button', { name: `Choose ${name}` }).tap();
  await expect(picker).toBeHidden({ timeout: 30_000 });
}
