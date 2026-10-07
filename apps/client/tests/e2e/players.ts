import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

// Signup needs the family code the dev server was started with (playwright.config.ts).
const signupCode = process.env['HP_SIGNUP_CODE'] ?? '';
/**
 * Every e2e account's password. It matches the server's `SEED_PASSWORD` only so
 * there's one password to remember; e2e never logs in as a seed account (each
 * spec signs up its own players), and the client package can't import the
 * server's (no dependency, and lint bans client→server imports).
 */
export const TEST_PASSWORD = 'squishy-secret';

/** A name nobody has used yet, e.g. `own_lq3x9a0` (usernames are global). */
export function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${String(test.info().workerIndex)}`;
}

/**
 * A new player in their own browser context (own cookies), signed up and in
 * the lobby. `code` is what they type in the code field: the dev server's
 * family code unless given (a patch invite also signs up, #195).
 */
export async function newPlayer(browser: Browser, name: string, code?: string): Promise<Page> {
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
  await slowCpu(page);
  await signUp(page, name, code);
  await pickKeeper(page);
  // Roomy: under a full e2e run the lobby's first fetches can take a while.
  await expect(
    page.getByTestId('lobby').getByRole('heading', { name: 'Your patches' }),
  ).toBeVisible({ timeout: 15_000 });
  return page;
}

/**
 * A local stand-in for CI's software-rendered WebKit (about 0.85–2 s a frame
 * at phone and tablet size): `HP_E2E_CPU_THROTTLE=<n>` slows the page's CPU
 * n times, through the DevTools protocol, so timing-sensitive specs (taps
 * under a resting finger, a tray mid-slide) can be tried under load with
 * `--repeat-each`. Chromium only (`PW_CHROMIUM_EXECUTABLE`); WebKit has no
 * such knob and ignores it.
 */
async function slowCpu(page: Page): Promise<void> {
  const rate = Number(process.env['HP_E2E_CPU_THROTTLE'] ?? '');
  if (!(rate > 1) || page.context().browser()?.browserType().name() !== 'chromium') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * Signs up through the sign-in overlay with a code and taps past the
 * recovery code. The Keeper picker (#42) comes next.
 */
export async function signUp(page: Page, name: string, code = signupCode): Promise<void> {
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family or invite code').fill(code);
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill(TEST_PASSWORD);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByRole('button', { name: 'I saved it!' }).tap();
}

/**
 * Presses on the opening cinematic and holds until it skips, then lets go,
 * like a finger watching the "Hold to skip" ring fill. The hold is checked
 * on drawn frames, and a software-rendered iPad in CI can go longer than the
 * hold between frames, so a fixed-length press could lift before any frame
 * saw it.
 */
export async function holdCinematic(page: Page): Promise<void> {
  const panel = page.getByTestId('cinematic');
  const press = { pointerType: 'touch', isPrimary: true, button: 0 };
  await panel.dispatchEvent('pointerdown', press);
  await expect(panel).toBeHidden({ timeout: 60_000 });
  await panel.dispatchEvent('pointerup', press);
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
  // The account's first pick shows Sprout's gift of Heart Charms first
  // (owner decision 2026-10-04); any later pick goes straight to the map.
  const go = picker.getByRole('button', { name: 'Let’s go!' });
  await expect
    .poll(async () => (await picker.isHidden()) || (await go.isVisible()), { timeout: 30_000 })
    .toBe(true);
  if (await go.isVisible()) await go.tap();
  await expect(picker).toBeHidden({ timeout: 30_000 });
}
