import { expect, test, type Locator, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

// The tutorial layer (#47). Asserts on signals from the dev hook (step id,
// spotlight target, gate), never on pixels. The dev server runs with
// HP_TUTORIAL_REQUIRED=false, so the tutorial is optional here.

/** The tutorial from the dev hook (src/tutorial/tutorial-screen.ts `TutorialDebug`). */
interface TutorialDebug {
  status: 'not-started' | 'in-progress' | 'completed' | null;
  stepId: string | null;
  mapId: string | null;
  line: number;
  overlay: { spotlightOn: string | null; gate: 'blockAll' | 'spotlight' | 'open' | null };
  sprout: string | null;
}

interface Hook {
  tutorial?(): TutorialDebug | null;
  map?(): { id: string } | null;
  updatesHeld?(): boolean;
}

const debug = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __heartpatch?: Hook }).__heartpatch?.tutorial?.() ?? null,
  );
/** The map the map screen is drawing, if any. */
const drawnMap = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __heartpatch?: Hook }).__heartpatch?.map?.()?.id ?? null,
  );
const updatesHeld = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __heartpatch?: Hook }).__heartpatch?.updatesHeld?.() ?? null,
  );

/** The `data-testid` of whatever takes a tap at (x, y) (or its nearest parent's). */
function testIdAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) =>
      document.elementFromPoint(px, py)?.closest('[data-testid]')?.getAttribute('data-testid') ??
      null,
    [x, y] as const,
  );
}

/** True if a tap at the centre of `target` reaches it. */
async function takesTaps(page: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox();
  if (!box) return false;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  return target.evaluate((node, [px, py]) => node.contains(document.elementFromPoint(px, py)), [
    x,
    y,
  ] as const);
}

/** What takes a tap at the centre of `target`. */
async function topAt(page: Page, target: Locator): Promise<string | null> {
  const box = await target.boundingBox();
  if (!box) return null;
  return testIdAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

test('the optional tutorial: start, resume after reload, graduate, replay and skip', async ({
  browser,
}) => {
  test.setTimeout(120_000); // draws the Glade three times; CI renders in software
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
  // Near the top of the screen, away from Sprout's bubble at the bottom.
  const width = page.viewportSize()?.width ?? 390;
  expect(await testIdAt(page, width / 2, 160)).toBe('tutorial-blocker');
  // ...except "Log out": nobody is ever stuck in the tutorial.
  expect(await takesTaps(page, page.getByRole('button', { name: 'Log out' }))).toBe(true);
  // Sprout joins the scene once the renderer is up.
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await debug(page))?.sprout).toMatch(/^[0-9a-f]{32}$/);
  // The Tutorial Glade is drawn as a normal map: the run's own map.
  const run = (await debug(page))?.mapId;
  expect(run).toBeTruthy();
  await expect.poll(() => drawnMap(page)).toBe(run);

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
  expect(await drawnMap(page)).toBeNull();

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
  test.setTimeout(120_000); // draws the Glade; CI renders in software
  const page = await newPlayer(browser, uniqueName('later'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByTestId('tutorial-start').tap();
  await expect.poll(async () => (await debug(page))?.stepId).toBe('welcome');
  // Wait for the Glade to be built and drawn: until then the page is busy
  // building it, and a tap can wait out the whole test.
  await expect.poll(async () => (await debug(page))?.mapId ?? null).not.toBeNull();
  const run = (await debug(page))?.mapId;
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(() => drawnMap(page), { timeout: 60_000 }).toBe(run);
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
