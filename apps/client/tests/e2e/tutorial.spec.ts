import { expect, test, type Locator, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { expectClear } from './layout.js';
import { newPlayer, savedCode, TEST_PASSWORD, uniqueName } from './players.js';
import { realTap } from './touch.js';
import { openTray, traysState, traySettled } from './trays.js';

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
  overlay: {
    target: string | null;
    spotlightOn: string | null;
    gate: 'blockAll' | 'spotlight' | 'guide' | 'open' | null;
    hole: { x: number; y: number; width: number; height: number } | null;
    held: boolean;
    docked: boolean;
    /** The sheets Sprout waits behind. */
    sheets: string[];
  };
  sprout: string | null;
}

const debug = (page: Page) => hook<TutorialDebug>(page, 'tutorial');
/** The map the map screen is drawing, if any. */
const drawnMap = async (page: Page) => (await hook<{ id: string }>(page, 'map'))?.id ?? null;
/** Dev only: moves the run straight to `stepId` (the server's `POST /tutorial/dev/step`). */
async function jumpTo(page: Page, stepId: string): Promise<void> {
  const { status } = await api(page, 'POST', '/tutorial/dev/step', { stepId });
  expect(status).toBe(200);
  await expect.poll(async () => (await debug(page))?.stepId).toBe(stepId);
}

const updatesHeld = (page: Page) => hook<boolean>(page, 'updatesHeld');

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

type Box = { x: number; y: number; width: number; height: number };
/** True when the two boxes share any area (touching edges don't count). */
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** What takes a tap at the centre of `target`. */
async function topAt(page: Page, target: Locator): Promise<string | null> {
  const box = await target.boundingBox();
  if (!box) return null;
  return testIdAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Finishing the tutorial earns The First Patch (#44): its celebration card
 * pops up over the lobby a moment later, once the player is off the form
 * graduation opened (one card at a time, #129). Tap "Yay!" before going on.
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
  // Sprout joins the scene once the renderer is up.
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await debug(page))?.sprout).toMatch(/^[0-9a-f]{32}$/);
  // The Tutorial Glade is drawn as a normal map: the run's own map.
  const run = (await debug(page))?.mapId;
  expect(run).toBeTruthy();
  await expect.poll(() => drawnMap(page)).toBe(run);
  // ...except "Log out": nobody is ever stuck in the tutorial. Over the map
  // it's in the Keeper menu in the corner, which takes taps too. The menu
  // replaces the chip only once the map's trays are up, so wait for them:
  // a "Log out" read mid-switch would wait on a button folded into the menu.
  await expect.poll(async () => (await traysState(page))?.visible).toBe(true);
  const menu = page.getByTestId('keeper-menu');
  expect(await takesTaps(page, menu)).toBe(true);
  await menu.tap();
  expect(await takesTaps(page, page.getByRole('button', { name: 'Log out' }))).toBe(true);
  await menu.tap();

  await bubble.getByRole('button', { name: 'Next' }).tap();
  expect((await debug(page))?.line).toBe(1);

  // Quitting keeps your place: a reload lands on the same step. A reload
  // boots the whole app again (sign-in, Keeper, story, tutorial check, each a
  // round trip), slow on a software-rendered iPad: wait for the stage and the
  // run's step from the dev hook, with the reload budget hollow.spec uses.
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await debug(page))?.stepId, { timeout: 30_000 }).toBe('welcome');
  await expect(tutorial).toBeVisible();

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
  // Finishing is The First Patch milestone (#44): it waits behind the form,
  // and celebrates once the player leaves it.
  await lobby.getByRole('button', { name: 'Back to my patches' }).tap();
  await celebrateFirstPatch(page);

  // Replay from Settings; a replay can be skipped.
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
  await overlay.getByLabel('Family or invite code').fill(process.env['HP_SIGNUP_CODE'] ?? '');
  await overlay.getByLabel('Pick a name').fill(uniqueName('hold'));
  await overlay.getByLabel('Pick a password').fill(TEST_PASSWORD);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  expect(await updatesHeld(page)).toBe(false);
  await overlay.getByRole('button', { name: 'Sign up' }).tap();

  await expect(overlay.getByTestId('auth-recovery-code')).toBeVisible();
  expect(await updatesHeld(page)).toBe(true);
  await savedCode(overlay);
  // "Next" lets go once the helper check (#197) answers.
  await expect.poll(() => updatesHeld(page)).toBe(false);
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
  const started = await api(page, 'POST', `/maps/${glade!}/battles`, { tile: { q: 0, r: 1 } });
  expect(started.status).toBe(201);
  const { battle } = started.body as {
    battle: {
      id: string;
      view: { turn: number; sides: { b: { squishies: { speciesId: string }[] } } };
    };
  };
  const befriended = battle.view.sides.b.squishies[0]?.speciesId;
  const captured = await api(page, 'POST', `/battles/${battle.id}/actions`, {
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
  // The night finds a lore page, and the morning report says the Partner
  // slept out in the open (no fire on this path): one card at a time, in
  // whichever order they land, and Sprout waits behind both (#127, #129).
  const card = page.getByTestId('lore-card');
  const okay = page.getByTestId('hollow-report-ok');
  const dismissReport = async () => {
    await expect(okay).toBeVisible({ timeout: 20_000 });
    await expect(card).toBeHidden();
    await okay.tap();
    await expect(okay).toBeHidden();
  };
  await expect
    .poll(async () => (await card.isVisible()) || (await okay.isVisible()), { timeout: 20_000 })
    .toBe(true);
  const reportFirst = await okay.isVisible();
  if (reportFirst) await dismissReport();
  // Two pages, oldest first: planting the Heart Seed found one (#307).
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('lore-title')).toHaveText('Where the Squishies Bloomed');
  await expect(card.getByTestId('lore-close')).toHaveText('Next page');
  await card.getByTestId('lore-close').tap();
  await expect(card.getByTestId('lore-title')).toHaveText('Paw Prints by the Fire');
  await card.getByTestId('lore-close').tap();
  await expect(card).toBeHidden();
  if (!reportFirst) await dismissReport();

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
  await lobby.getByLabel('Patch name').fill('Partner Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  // The First Patch party waited behind the form; it comes now, alone.
  await celebrateFirstPatch(page);
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();

  // The starter pick opens on the Partner's species; any can still be picked.
  const picker = page.getByTestId('starter-picker');
  await expect(picker.getByRole('heading', { name: 'Choose your friend!' })).toBeVisible();
  const partner = (await hook<{ picked: string | null }>(page, 'starter'))?.picked ?? null;
  expect(partner).toBe(befriended);
  await expect(picker.getByRole('button', { name: /^Choose \w+$/ })).toBeEnabled();
});

test('the gather step, played for real: tap the tree tile, Gather, wait, and it lands', async ({
  browser,
}) => {
  test.setTimeout(120_000); // draws the Glade; CI renders in software
  const page = await newPlayer(browser, uniqueName('gather'));
  const bubble = page.getByTestId('tutorial-bubble');
  const main = bubble.getByTestId('tutorial-main');
  const readAll = async () => {
    while ((await main.isVisible()) && (await main.textContent()) === 'Next') await main.tap();
  };
  const step = async (id: string) => {
    await expect.poll(async () => (await debug(page))?.stepId, { timeout: 15_000 }).toBe(id);
  };
  const overlay = async () => (await debug(page))?.overlay;

  await page.getByTestId('lobby').getByTestId('tutorial-start').tap();
  await step('welcome');
  const run = (await debug(page))?.mapId;
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(() => drawnMap(page), { timeout: 60_000 }).toBe(run);
  // The home nodes stand on the map: Timber, Emberwood, Stone and the farm plot.
  expect((await hook<{ homeNodes: number }>(page, 'map'))?.homeNodes).toBe(4);
  await readAll();
  await main.tap(); // Got it!
  await step('plant');
  await readAll();
  await main.tap(); // Plant it!
  await step('gather');
  await readAll();
  await main.tap(); // Let's go!

  // Sprout's spotlight lands on the tree tile (a canvas target), and only it takes taps.
  await expect.poll(async () => (await overlay())?.gate).toBe('spotlight');
  const hole = (await overlay())?.hole;
  expect(hole).toBeTruthy();
  expect((await overlay())?.spotlightOn).toBeNull(); // on the canvas, not a button
  await page.touchscreen.tap(hole!.x + hole!.width / 2, hole!.y + hole!.height / 2);

  // The tile panel offers Gather, and the spotlight moves onto it.
  const gather = page.getByTestId('tile-gather');
  await expect(gather).toBeVisible();
  await expect.poll(async () => (await overlay())?.spotlightOn).toBe('resource-node');
  expect(await takesTaps(page, gather)).toBe(true);
  await gather.tap();

  // Something clearly happens: a countdown in the panel and a chip over the map.
  await expect(page.getByTestId('tile-gathering')).toContainText('Gathering…');
  await expect(page.getByTestId('gather-chip')).toContainText('Timber');
  expect((await hook<{ chip: string | null }>(page, 'inventory'))?.chip).toBe('waiting');

  // The Glade's gather takes 5 seconds; then the Timber goes straight into
  // the bag with a pop-up, no Collect (owner decision 2026-10-06), and its
  // `resource.gathered` finishes the step.
  await expect(page.getByTestId('landed-toast')).toContainText('Timber', { timeout: 15_000 });
  await step('hearthfire');
  await expect(page.getByTestId('gather-chip')).toBeHidden();
  await expect(page.getByTestId('tile-collect')).toHaveCount(0);
});

test('first battle: Sprout points at the Adventure handle, then at Find a squishy inside', async ({
  browser,
}) => {
  test.setTimeout(120_000); // draws the Glade; CI renders in software
  const page = await newPlayer(browser, uniqueName('tray'));
  const bubble = page.getByTestId('tutorial-bubble');
  const main = bubble.getByTestId('tutorial-main');
  const overlay = async () => (await debug(page))?.overlay;
  const inHole = async (target: Locator) => {
    const hole = (await overlay())?.hole;
    const box = await target.boundingBox();
    if (!hole || !box) return false;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return cx >= hole.x && cx <= hole.x + hole.width && cy >= hole.y && cy <= hole.y + hole.height;
  };

  await page.getByTestId('lobby').getByTestId('tutorial-start').tap();
  await expect.poll(async () => (await debug(page))?.stepId, { timeout: 15_000 }).toBe('welcome');
  const run = (await debug(page))?.mapId;
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(() => drawnMap(page), { timeout: 60_000 }).toBe(run);
  await jumpTo(page, 'first-battle');
  // Sprout never covers the handle it's talking about: talking, then tucked,
  // on a small phone and an iPad both ways round (owner, 2026-10-05).
  const sproutClear = async () => {
    for (const size of [
      { width: 375, height: 667 },
      { width: 820, height: 1180 },
      { width: 1180, height: 820 },
    ]) {
      await page.setViewportSize(size);
      await expect(async () => {
        await expectClear(
          page,
          '[data-testid="tutorial-bubble"]',
          '[data-testid="tutorial-spotlight"]:not([hidden])',
        );
      }).toPass({ timeout: 15_000 }); // a new size draws slowly in software
    }
    await page.setViewportSize({ width: 375, height: 667 });
  };
  await expect.poll(async () => (await overlay())?.spotlightOn).toBe('wild-squishy');
  await sproutClear();
  while ((await main.isVisible()) && (await main.textContent()) === 'Next') await main.tap();
  if (await main.isVisible()) await main.tap(); // Let's go!
  await sproutClear();

  // The tray is shut: the spotlight is on its handle, which takes the tap.
  const handle = page.getByTestId('tray-handle-adventure');
  await expect.poll(async () => (await overlay())?.gate).toBe('spotlight');
  expect((await overlay())?.spotlightOn).toBe('wild-squishy');
  await expect.poll(() => inHole(handle)).toBe(true);
  expect(await takesTaps(page, handle)).toBe(true);
  // Every frame of the slide: the tray is on the step's way, so Sprout never
  // waits behind it (its handle stands in for it until it has slid open).
  await page.evaluate(() => {
    const w = window as unknown as {
      __heldFrames?: number;
      __heartpatch?: { tutorial?: () => { overlay: { held: boolean } } | null };
    };
    w.__heldFrames = 0;
    const sample = () => {
      if (w.__heartpatch?.tutorial?.()?.overlay.held) w.__heldFrames! += 1;
      if (w.__heldFrames !== undefined) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await handle.tap();

  // Once the tray has slid open, the spotlight rests on Find a squishy, which takes taps.
  const entry = page.getByTestId('battle-entry');
  await expect.poll(() => inHole(entry), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => takesTaps(page, entry)).toBe(true);
  const heldFrames = await page.evaluate(() => {
    const w = window as unknown as { __heldFrames?: number };
    const n = w.__heldFrames;
    delete w.__heldFrames;
    return n;
  });
  expect(heldFrames).toBe(0);
  // The spotlight stays; the tucked chip, which would cover the tray on this
  // small phone, docks into the orb clear of it.
  await expect(async () => {
    expect((await overlay())?.spotlightOn).toBe('wild-squishy');
    expect((await overlay())?.docked).toBe(true);
    const [chip, panel] = [
      await bubble.boundingBox(),
      await page.getByTestId('tray-adventure').boundingBox(),
    ];
    expect(chip && panel && !overlaps(chip, panel), JSON.stringify([chip, panel])).toBe(true);
    expect(await takesTaps(page, bubble)).toBe(true);
  }).toPass({ timeout: 10_000 });
});

test("Sprout's tucked chip steps aside for an open tray, so its rows take taps", async ({
  browser,
}) => {
  test.setTimeout(120_000); // draws the Glade; CI renders in software
  const page = await newPlayer(browser, uniqueName('aside'));
  const bubble = page.getByTestId('tutorial-bubble');
  const main = bubble.getByTestId('tutorial-main');
  const tray = page.getByTestId('tray-adventure');
  const overlay = async () => (await debug(page))?.overlay;

  await page.getByTestId('lobby').getByTestId('tutorial-start').tap();
  await expect.poll(async () => (await debug(page))?.stepId, { timeout: 15_000 }).toBe('welcome');
  const run = (await debug(page))?.mapId;
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(() => drawnMap(page), { timeout: 60_000 }).toBe(run);
  // The owner's step: "Give them a home", tucked into the chip at the left edge.
  await jumpTo(page, 'habitat');
  while ((await main.isVisible()) && (await main.textContent()) === 'Next') await main.tap();
  await main.tap(); // Let's go!
  await expect(page.getByTestId('tutorial')).toHaveClass(/tutorial-tucked/);
  // Measure the chip in its own place, settled: not waiting as the orb behind
  // a card that turned up late (the orb sits clear of every button, so it
  // would cover no row below), and not still moving between two samples.
  let chip = null as { x: number; y: number; width: number; height: number } | null;
  await expect(async () => {
    const state = await overlay();
    expect(state?.held, `Sprout waits behind ${JSON.stringify(state?.sheets)}`).toBe(false);
    expect(state?.docked).toBe(false);
    const [a, b] = [await bubble.boundingBox(), await bubble.boundingBox()];
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    chip = a;
  }).toPass({ timeout: 15_000 });

  // Adventure isn't on this step's way: Sprout waits in its orb, clear of the tray.
  await openTray(page, 'adventure');
  await traySettled(page, 'adventure');
  // Rows the chip sat on before (the owner's Claim land and Report).
  const covered: string[] = await tray.evaluate((node, was) => {
    const out: string[] = [];
    for (const row of node.querySelectorAll<HTMLElement>('button[data-testid]')) {
      const r = row.getBoundingClientRect();
      const hit =
        r.width > 0 &&
        r.left < was.x + was.width &&
        was.x < r.right &&
        r.top < was.y + was.height &&
        was.y < r.bottom;
      if (hit && !row.closest('[hidden]')) out.push(row.dataset['testid'] ?? '');
    }
    return out;
  }, chip!);
  const rows = await tray.evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>('button[data-testid]')].map((row) => {
      const r = row.getBoundingClientRect();
      return `${row.dataset['testid'] ?? ''}@${String(Math.round(r.y))}+${String(Math.round(r.height))}`;
    }),
  );
  expect(
    covered.length,
    `chip ${JSON.stringify(chip)} over rows ${rows.join(' ')}`,
  ).toBeGreaterThan(0);

  const clearOfTray = async () => {
    await expect(async () => {
      const state = await overlay();
      expect(state?.held).toBe(true);
      const [orb, panel] = [await bubble.boundingBox(), await tray.boundingBox()];
      expect(orb && panel && !overlaps(orb, panel), JSON.stringify([orb, panel])).toBe(true);
      // The orb's own tap target stays reachable: nothing sits on it.
      expect(await takesTaps(page, bubble)).toBe(true);
    }).toPass({ timeout: 15_000 }); // a new size draws slowly in software
  };
  const home = page.viewportSize()!;
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
  ]) {
    await page.setViewportSize(size);
    await traySettled(page, 'adventure');
    await clearOfTray();
  }
  await page.setViewportSize(home);
  await traySettled(page, 'adventure');
  await clearOfTray();

  // A row the chip used to cover takes the tap (it reaches the row, which shuts the tray).
  const row = tray.getByTestId(covered[0]!);
  expect(await takesTaps(page, row)).toBe(true);
  await realTap(row);
  await expect.poll(async () => (await traysState(page))?.open, { timeout: 15_000 }).toBeNull();
});
