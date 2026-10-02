import { expect, test, type Locator, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

// The tutorial layer (#47). Asserts on signals from the dev hook (step id,
// spotlight target, gate), never on pixels. The dev server runs with
// HP_TUTORIAL_REQUIRED=false, so the tutorial is optional here.

/** The tutorial from the dev hook (src/tutorial/tutorial-screen.ts `TutorialDebug`). */
interface TutorialDebug {
  status: 'not-started' | 'in-progress' | 'completed' | null;
  stepId: string | null;
  line: number;
  overlay: { spotlightOn: string | null; gate: 'blockAll' | 'spotlight' | 'open' | null };
  sprout: string | null;
}

interface Hook {
  tutorial?(): TutorialDebug | null;
  updatesHeld?(): boolean;
}

const debug = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __heartpatch?: Hook }).__heartpatch?.tutorial?.() ?? null,
  );
const updatesHeld = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __heartpatch?: Hook }).__heartpatch?.updatesHeld?.() ?? null,
  );

/** The `data-testid` of whatever takes a tap at the centre of `target` (or its nearest parent's). */
async function topAt(page: Page, target: Locator): Promise<string | null> {
  const box = await target.boundingBox();
  if (!box) return null;
  return page.evaluate(
    ([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
    },
    [box.x + box.width / 2, box.y + box.height / 2] as const,
  );
}

test('the optional tutorial: start, resume after reload, graduate, replay and skip', async ({
  browser,
}) => {
  const page = await newPlayer(browser, uniqueName('sprout'));
  const lobby = page.getByTestId('lobby');
  const tutorial = page.getByTestId('tutorial');
  const bubble = page.getByTestId('tutorial-bubble');

  // With the gate off, a new player lands in the lobby, with Sprout on offer.
  await expect(lobby.getByTestId('tutorial-start')).toBeVisible();
  await expect(tutorial).toBeHidden();
  expect((await debug(page))?.status).toBe('not-started');

  await lobby.getByTestId('tutorial-start').tap();
  await expect(tutorial).toBeVisible();
  await expect.poll(async () => (await debug(page))?.stepId).toBe('welcome');
  // Sprout is just talking: everything behind the bubble is blocked.
  expect((await debug(page))?.overlay.gate).toBe('blockAll');
  const heading = lobby.getByRole('heading', { name: 'Your patches' });
  expect(await topAt(page, heading)).toBe('tutorial-blocker');
  // Sprout joins the scene once the renderer is up.
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await debug(page))?.sprout).toMatch(/^[0-9a-f]{32}$/);

  await bubble.getByRole('button', { name: 'Next' }).tap();
  expect((await debug(page))?.line).toBe(1);

  // Quitting keeps your place: a reload lands on the same step.
  await page.reload();
  await expect(tutorial).toBeVisible();
  await expect.poll(async () => (await debug(page))?.stepId).toBe('welcome');

  await bubble.getByRole('button', { name: 'Next' }).tap();
  await bubble.getByRole('button', { name: 'Got it!' }).tap();
  // The server's step engine moves on and says so over live sync.
  await expect.poll(async () => (await debug(page))?.stepId).toBe('graduation');

  await bubble.getByRole('button', { name: 'Next' }).tap();
  // Graduation spotlights its two choices, and only they take taps.
  await expect
    .poll(async () => (await debug(page))?.overlay.spotlightOn)
    .toBe('graduation-choices');
  expect((await debug(page))?.overlay.gate).toBe('spotlight');
  const choices = page.locator('[data-tutorial-target="graduation-choices"]');
  await choices.getByRole('button', { name: 'Make a patch' }).tap();

  // Done: the tutorial closes and the lobby opens "Make a patch".
  await expect(tutorial).toBeHidden();
  await expect(lobby.getByRole('heading', { name: 'Make a patch' })).toBeVisible();
  expect((await debug(page))?.status).toBe('completed');
  expect((await debug(page))?.sprout).toBeNull();

  // Replay from Settings; a replay can be skipped.
  await lobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await expect(lobby.getByTestId('tutorial-start')).toBeHidden();
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('tutorial-replay').tap();
  await expect(tutorial).toBeVisible();
  await expect.poll(async () => (await debug(page))?.stepId).toBe('welcome');
  await bubble.getByRole('button', { name: 'Skip it' }).tap();
  await expect(tutorial).toBeHidden();
  expect((await debug(page))?.status).toBe('completed');
});

test('"Later" puts the optional tutorial away, and the lobby offers it back', async ({
  browser,
}) => {
  const page = await newPlayer(browser, uniqueName('later'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByTestId('tutorial-start').tap();
  await expect.poll(async () => (await debug(page))?.stepId).toBe('welcome');
  // A first run can't be skipped.
  await expect(
    page.getByTestId('tutorial-bubble').getByRole('button', { name: 'Skip it' }),
  ).toBeHidden();
  await page.getByTestId('tutorial-bubble').getByRole('button', { name: 'Later' }).tap();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  expect(await topAt(page, lobby.getByTestId('lobby-settings'))).toBe('lobby-settings');
  await expect(lobby.getByTestId('tutorial-resume')).toBeVisible();
});

test("an update can't reload away a new account's recovery code", async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family code').fill(process.env['HP_SIGNUP_CODE'] ?? '');
  await overlay.getByLabel('Pick a name').fill(uniqueName('hold'));
  await overlay.getByLabel('Pick a password').fill('squishy-secret');
  await overlay.getByLabel('Year you were born').selectOption('2014');
  expect(await updatesHeld(page)).toBe(false);
  await overlay.getByRole('button', { name: 'Sign up' }).tap();

  await expect(overlay.getByTestId('auth-recovery-code')).toBeVisible();
  expect(await updatesHeld(page)).toBe(true);
  await overlay.getByRole('button', { name: 'I saved it!' }).tap();
  expect(await updatesHeld(page)).toBe(false);
});
