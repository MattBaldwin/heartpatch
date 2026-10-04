import { expect, test, type Locator, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

// The tutorial layer (#47) and The First Patch (#24). Asserts on signals from
// the dev hook (step id, spotlight target, gate), never on pixels. The dev
// server runs with HP_TUTORIAL_REQUIRED=false, so the tutorial is optional
// here. Gameplay steps are played for real in the server's tutorial.test.ts;
// these jump over them with the dev step route.

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
/** Dev only: moves the run straight to `stepId` (the server's `POST /tutorial/dev/step`). */
async function jumpTo(page: Page, stepId: string): Promise<void> {
  const status = await page.evaluate(async (id) => {
    const res = await fetch('/api/v1/tutorial/dev/step', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'heartpatch' },
      body: JSON.stringify({ stepId: id }),
    });
    return res.status;
  }, stepId);
  expect(status).toBe(200);
  await expect.poll(async () => (await debug(page))?.stepId).toBe(stepId);
}

/** `POST /api/v1/<path>` with the player's cookie: status and JSON body. */
const apiPost = (page: Page, path: string, body: object) =>
  page.evaluate(
    async ([p, b]) => {
      const res = await fetch(`/api/v1${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'heartpatch' },
        body: JSON.stringify(b),
      });
      return { status: res.status, body: (await res.json()) as unknown };
    },
    [path, body] as const,
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

/**
 * Finishing the tutorial earns The First Patch (#44): its celebration card
 * pops up over the lobby a moment later. Tap "Yay!" before going on.
 */
async function celebrateFirstPatch(page: Page): Promise<void> {
  const party = page.getByTestId('milestone-card');
  await expect(party).toBeVisible({ timeout: 20_000 });
  await expect(party.getByTestId('milestone-name')).toHaveText('The First Patch');
  await party.getByTestId('milestone-yay').tap();
  await expect(party).toBeHidden();
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
  await expect.poll(async () => (await debug(page))?.stepId).toBe('plant');
  // Over the gameplay steps (the full run below covers the rest).
  await jumpTo(page, 'graduation');

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
  // Finishing is The First Patch milestone (#44): celebrate it first.
  await celebrateFirstPatch(page);

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

test('The First Patch: plant, befriend and name a Partner, nightfall, scarf, graduate', async ({
  browser,
}) => {
  test.setTimeout(180_000); // draws the Glade and a patch; CI renders in software
  const page = await newPlayer(browser, uniqueName('patch'));
  const lobby = page.getByTestId('lobby');
  const bubble = page.getByTestId('tutorial-bubble');
  const main = bubble.getByTestId('tutorial-main');
  const readAll = async () => {
    while ((await main.isVisible()) && (await main.textContent()) === 'Next') await main.tap();
  };
  const step = async (id: string) => {
    await expect.poll(async () => (await debug(page))?.stepId, { timeout: 15_000 }).toBe(id);
  };

  await lobby.getByTestId('tutorial-start').tap();
  await step('welcome');
  const glade = (await debug(page))?.mapId ?? null;
  expect(glade).not.toBeNull();
  await readAll();
  await main.tap(); // Got it!
  await step('plant');
  await readAll();
  await expect(main).toHaveText('Plant it!');
  await main.tap();
  await step('gather');
  // A gameplay step tucks Sprout away, so the game underneath takes taps.
  await readAll();
  await expect(main).toHaveText("Let's go!");
  await main.tap();
  await expect(page.getByTestId('tutorial')).toHaveClass(/tutorial-tucked/);
  expect((await debug(page))?.overlay.gate).not.toBe('blockAll');

  // Befriend a starter in the Glade (the battle itself is server-tested).
  await jumpTo(page, 'befriend');
  const started = await apiPost(page, `/maps/${glade!}/battles`, { tile: { q: 0, r: 1 } });
  expect(started.status).toBe(201);
  const { battle } = started.body as {
    battle: {
      id: string;
      view: { turn: number; sides: { b: { squishies: { speciesId: string }[] } } };
    };
  };
  const befriended = battle.view.sides.b.squishies[0]?.speciesId;
  const captured = await apiPost(page, `/battles/${battle.id}/actions`, {
    action: { type: 'capture' },
    turn: battle.view.turn,
  });
  expect(captured.status).toBe(200);
  await step('name-partner');

  // Name the Partner right in Sprout's bubble.
  await readAll();
  await bubble.getByTestId('tutorial-name-input').fill('Sunny');
  await bubble.getByTestId('tutorial-name-save').tap();
  await step('care');

  // Night falls on the Glade: nothing is taken, and a lore page turns up.
  await jumpTo(page, 'nightfall');
  await readAll();
  await expect(main).toHaveText('Night falls');
  await main.tap();
  await step('evolve');
  const card = page.getByTestId('lore-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('lore-title')).toHaveText('Paw Prints by the Fire');
  await card.getByTestId('lore-close').tap();
  await expect(card).toBeHidden();

  // The Seedling Scarf, on in the Wardrobe.
  await jumpTo(page, 'wardrobe');
  await readAll();
  await expect(main).toHaveText('Wardrobe');
  await main.tap();
  const wardrobe = page.getByTestId('wardrobe');
  await expect(wardrobe).toBeVisible();
  await wardrobe.getByRole('tab', { name: /Tops/ }).tap();
  await wardrobe
    .getByTestId('wardrobe-items')
    .getByRole('button', { name: /Seedling Scarf/ })
    .tap();
  // Once it's on, Sprout moves on and the Glade comes back.
  await step('graduation');
  await expect(wardrobe).toBeHidden();

  await readAll();
  await page
    .locator('[data-tutorial-target="graduation-choices"]')
    .getByRole('button', { name: 'Make a patch' })
    .tap();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await celebrateFirstPatch(page);
  await lobby.getByLabel('Patch name').fill('Partner Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();

  // The starter pick opens on the Partner's species; any can still be picked.
  const picker = page.getByTestId('starter-picker');
  await expect(picker.getByRole('heading', { name: 'Choose your friend!' })).toBeVisible();
  const partner = await page.evaluate(
    () =>
      (
        window as unknown as { __heartpatch?: { starter?(): { picked: string | null } | null } }
      ).__heartpatch?.starter?.()?.picked ?? null,
  );
  expect(partner).toBe(befriended);
  await expect(picker.getByRole('button', { name: /^Choose \w+$/ })).toBeEnabled();
});
