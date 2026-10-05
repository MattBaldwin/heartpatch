import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, skipCinematic, TEST_PASSWORD, uniqueName } from './players.js';
import { realTap, realTapAt } from './touch.js';

/**
 * The whole tutorial, tapped the way a finger does (touch.ts), with a reload
 * at every step. Sprout waits its turn (#127, #128, #139): no bubble or
 * blocker ever takes a tap meant for a sheet unless the step spotlights that
 * sheet on purpose, the Hollow's morning report is never stuck under the
 * gate, cards come one at a time (#129), "Light a Hearthfire" guides without
 * blocking (#140) and no tutorial request is ever aborted (#163). Asserted
 * through the dev hook and hit-testing, never pixels. Battles the player
 * can't win on purpose go through the API (the server's tutorial.test.ts
 * plays them for real); everything the player taps is tapped here.
 */

interface TutorialDebug {
  status: string | null;
  stepId: string | null;
  mapId: string | null;
  line: number;
  overlay: {
    target: string | null;
    spotlightOn: string | null;
    gate: 'blockAll' | 'spotlight' | 'guide' | 'open' | null;
    hole: { x: number; y: number; width: number; height: number } | null;
    held: boolean;
    sheets: string[];
  };
}
interface HollowDebug {
  report: string[];
}
interface BattleStart {
  battle: { id: string; view: { turn: number } };
}

const debug = (page: Page) => hook<TutorialDebug>(page, 'tutorial');
const overlay = async (page: Page) => (await debug(page))?.overlay ?? null;
const drawnMap = async (page: Page) => (await hook<{ id: string }>(page, 'map'))?.id ?? null;
const slow = { timeout: 30_000 };

/**
 * True if a tap at the centre of `target` (scrolled into view, as a finger
 * would) reaches it. Scrolled in the page itself: Playwright's own scroll
 * waits for the box to hold still, which a sparkling card never does.
 */
async function takesTaps(target: Locator): Promise<boolean> {
  if (!(await target.isVisible())) return false;
  return target.evaluate((node) => {
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const box = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
}

/** The centre of `target` sits inside the spotlight hole. */
async function inHole(page: Page, target: Locator): Promise<boolean> {
  const hole = (await overlay(page))?.hole;
  const box = await target.boundingBox();
  if (!hole || !box) return false;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= hole.x && cx <= hole.x + hole.width && cy >= hole.y && cy <= hole.y + hole.height;
}

/**
 * No tutorial blocker sits on any button of an open sheet, unless the step's
 * spotlight hole is inside that very sheet (a spotlight on the care sheet's
 * buttons gates the care sheet on purpose). While Sprout waits behind a
 * sheet there are no blockers at all.
 */
async function expectNoTrap(page: Page): Promise<void> {
  const state = await overlay(page);
  const trapped = await page.evaluate((hole) => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && !el.closest('[hidden]');
    };
    for (const sheet of document.querySelectorAll('[role="dialog"]')) {
      if (sheet.closest('.tutorial') || !visible(sheet)) continue;
      const r = sheet.getBoundingClientRect();
      // A sheet under another sheet (home under care) can't be tapped anyway.
      const top = document
        .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        .find((el) => !el.closest('.tutorial'));
      if (top && !sheet.contains(top)) continue;
      const gated =
        hole !== null &&
        hole.x >= r.left &&
        hole.y >= r.top &&
        hole.x + hole.width <= r.right + 1 &&
        hole.y + hole.height <= r.bottom + 1;
      if (gated) continue;
      for (const button of sheet.querySelectorAll('button')) {
        if (!visible(button)) continue;
        const b = button.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (top?.closest('.tutorial')) {
          out.push(`${button.dataset['testid'] ?? button.textContent.trim()} under Sprout`);
        }
      }
    }
    return out;
  }, state?.hole ?? null);
  expect(trapped, JSON.stringify(state)).toEqual([]);
  if (state?.held) await expect(page.getByTestId('tutorial-blocker')).toHaveCount(0);
}

/** Sprout's bubble shares no area with any visible button outside the tutorial layer (#139). */
async function expectClearOfButtons(page: Page): Promise<void> {
  const hits = await page.evaluate(() => {
    const bubble = document.querySelector('[data-testid="tutorial-bubble"]');
    if (!bubble) return ['no bubble'];
    const a = bubble.getBoundingClientRect();
    const out: string[] = [];
    for (const button of document.querySelectorAll('button')) {
      if (button.closest('.tutorial') || button.closest('[hidden]')) continue;
      const r = button.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (a.left < r.right && r.left < a.right && a.top < r.bottom && r.top < a.bottom) {
        out.push(button.dataset['testid'] ?? button.textContent.trim());
      }
    }
    return out;
  });
  expect(hits).toEqual([]);
}

async function playTutorial(page: Page): Promise<void> {
  const aborted: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/v1/tutorial/')) {
      aborted.push(`${request.url()} ${request.failure()?.errorText ?? ''}`);
    }
  });
  /** A real tap that fails fast (expect's timeout) when the control isn't on screen. */
  const tapOn = async (target: Locator) => {
    await expect(target).toBeVisible();
    await realTap(target);
  };
  const lobby = page.getByTestId('lobby');
  const tutorial = page.getByTestId('tutorial');
  const bubble = page.getByTestId('tutorial-bubble');
  const main = bubble.getByTestId('tutorial-main');
  const step = async (id: string) => {
    await expect.poll(async () => (await debug(page))?.stepId, slow).toBe(id);
  };
  /** Taps Next through Sprout's lines (the last line may hide the button: the name box). */
  const readAll = async () => {
    await expect(main).toBeVisible();
    while ((await main.isVisible()) && (await main.textContent()) === 'Next') {
      await tapOn(main);
      await page.waitForTimeout(150);
    }
  };
  /** The Glade is drawn and Sprout is on screen. */
  const settled = async (glade: string) => {
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect.poll(() => drawnMap(page), { timeout: 60_000 }).toBe(glade);
    await expect(tutorial).toBeVisible();
  };
  /** Quitting keeps your place: a reload lands on the same step, with nothing trapped. */
  const reloadAt = async (id: string, glade: string) => {
    await page.reload();
    await step(id);
    await settled(glade);
    await expectNoTrap(page);
  };
  /**
   * A wild showdown through the API, on the first tile around home that
   * still has a squishy (a befriended one is gone for the rest of its window).
   */
  const wildBattle = async (glade: string, action: 'forfeit' | 'capture') => {
    let started: { status: number; body: BattleStart } | null = null;
    for (const tile of [
      { q: 0, r: 1 },
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
    ]) {
      started = await api<BattleStart>(page, 'POST', `/maps/${glade}/battles`, { tile });
      if (started.status === 201) break;
    }
    expect(started?.status).toBe(201);
    const { battle } = started!.body;
    const ended = await api(page, 'POST', `/battles/${battle.id}/actions`, {
      action: { type: action },
      turn: battle.view.turn,
    });
    expect(ended.status).toBe(200);
  };
  const openHome = async () => {
    await tapOn(page.getByTestId('tray-handle-heartpatch'));
    const home = page.getByTestId('home-open');
    await expect(home).toBeVisible();
    await expect.poll(() => takesTaps(home)).toBe(true);
    await tapOn(home);
    await expect(page.getByTestId('home')).toBeVisible(slow);
  };

  // Welcome, then plant: Sprout talks, and only the bubble takes taps.
  await tapOn(lobby.getByTestId('tutorial-start'));
  await step('welcome');
  const glade = (await debug(page))?.mapId ?? '';
  expect(glade).not.toBe('');
  await settled(glade);
  await reloadAt('welcome', glade);
  expect((await overlay(page))?.gate).toBe('blockAll');
  await readAll();
  await expect(main).toHaveText('Got it!');
  await tapOn(main);
  await step('plant');
  await reloadAt('plant', glade);
  await readAll();
  await expect(main).toHaveText('Plant it!');
  await tapOn(main);
  await step('gather');
  await reloadAt('gather', glade);

  // Gather, for real: the tree tile, Gather, then Collect in the tile chip.
  await readAll();
  await expect(main).toHaveText("Let's go!");
  await tapOn(main);
  await expect.poll(async () => (await overlay(page))?.gate).toBe('spotlight');
  const hole = (await overlay(page))?.hole;
  expect(hole).toBeTruthy();
  await realTapAt(page, hole!.x + hole!.width / 2, hole!.y + hole!.height / 2);
  const panel = page.getByTestId('tile-panel');
  const gather = panel.getByTestId('tile-gather');
  await expect(gather).toBeVisible();
  await expect.poll(async () => (await overlay(page))?.spotlightOn).toBe('resource-node');
  await expect.poll(() => takesTaps(gather)).toBe(true);
  await tapOn(gather);
  const collect = panel.getByTestId('tile-collect');
  await expect(collect).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => takesTaps(collect)).toBe(true);
  await tapOn(collect);
  await step('hearthfire');

  // #128: the new step's bubble waits behind the tile chip as a small orb,
  // so the chip's own buttons take the next tap; it opens once the chip closes.
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  expect((await overlay(page))?.sheets).toContain('tile-panel');
  expect((await overlay(page))?.gate).toBe('open');
  await expectNoTrap(page);
  await expectClearOfButtons(page);
  const close = panel.getByRole('button', { name: 'Close' });
  await expect.poll(() => takesTaps(close), slow).toBe(true);
  await tapOn(close);
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(false);
  await expect(main).toBeVisible();
  await expect(main).toHaveText('Next');

  // #140: "Light a Hearthfire" guides without blocking: the My Heartpatch
  // handle is lit and pointed at, then Home inside, then Build at home.
  await readAll();
  await expect.poll(async () => (await overlay(page))?.gate).toBe('guide');
  expect((await overlay(page))?.spotlightOn).toBe('build-button');
  const handle = page.getByTestId('tray-handle-heartpatch');
  await expect.poll(() => inHole(page, handle)).toBe(true);
  await expect(page.getByTestId('tutorial-blocker')).toHaveCount(0);
  await expect.poll(() => takesTaps(handle)).toBe(true);
  await tapOn(handle);
  const homeButton = page.getByTestId('home-open');
  await expect.poll(() => inHole(page, homeButton), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => takesTaps(homeButton)).toBe(true);
  await tapOn(homeButton);
  await expect(page.getByTestId('home')).toBeVisible(slow);
  await expect.poll(() => inHole(page, page.getByTestId('home-build')), slow).toBe(true);
  expect((await overlay(page))?.gate).toBe('guide');
  await reloadAt('hearthfire', glade);
  // Build and fuel it by hand, the guide leading: Build, the Hearthfire in
  // the list, a spot, then Add fuel (the Emberwood from the dev bag, as the
  // gather is tapped for real above).
  const items = await api(page, 'POST', `/maps/${glade}/dev/items`, {
    items: { timber: 20, stone: 20, emberwood: 5 },
  });
  expect(items.status).toBe(201);
  await openHome();
  const sheet = page.getByTestId('home');
  await expect.poll(() => inHole(page, sheet.getByTestId('home-build')), slow).toBe(true);
  await tapOn(sheet.getByTestId('home-build'));
  const row = sheet.locator('[data-build="hearthfire"]');
  await expect.poll(() => inHole(page, row), slow).toBe(true);
  expect((await overlay(page))?.gate).toBe('guide');
  await tapOn(row);
  await tapOn(sheet.getByTestId('home-anywhere'));
  const fuel = sheet.getByTestId('home-fuel');
  await expect(fuel).toBeVisible(slow);
  await expect.poll(() => inHole(page, fuel), slow).toBe(true);
  await expect.poll(() => takesTaps(fuel)).toBe(true);
  await tapOn(fuel);
  await step('first-battle');
  // Sprout waits behind the home sheet; Done, then Back to map, take one tap each.
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  await expectNoTrap(page);
  await tapOn(sheet.getByTestId('home-done'));
  await tapOn(sheet.getByTestId('home-back'));
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(false);
  const me = (await api<{ user: { id: string } }>(page, 'GET', '/me')).body.user.id;
  const view = await api<{
    tiles: { q: number; r: number; homeSlot: number | null; ownerUserId: string | null }[];
  }>(page, 'GET', `/maps/${glade}/view`);
  const home = view.body.tiles.find((t) => t.homeSlot !== null && t.ownerUserId === me);
  expect(home).toBeTruthy();
  await reloadAt('first-battle', glade);

  // The first battle and the capture (server-tested), then the Partner's name, tapped in.
  await wildBattle(glade, 'forfeit');
  await step('befriend');
  await reloadAt('befriend', glade);
  await wildBattle(glade, 'capture');
  await step('name-partner');
  await reloadAt('name-partner', glade);
  await readAll();
  // #154: Save with nothing typed gets a nudge, then the box comes back.
  await tapOn(bubble.getByTestId('tutorial-name-save'));
  await expect(bubble.getByTestId('tutorial-line')).toHaveText('Pick a name first!');
  await tapOn(main); // Try again
  await bubble.getByTestId('tutorial-name-input').fill('Sunny');
  await tapOn(bubble.getByTestId('tutorial-name-save'));
  await step('care');
  await reloadAt('care', glade);

  // Care, for real: Home, the Partner's sheet, Pet.
  await readAll();
  await tapOn(main); // Let's go!
  await openHome();
  await tapOn(page.getByTestId('home-friends').getByRole('button').first());
  const care = page.getByTestId('care');
  await expect(care).toBeVisible();
  // The spotlight is on Pet, Play and Feed (the care sheet is gated on
  // purpose), and Sprout's chip sits clear of every button (#139).
  await expect.poll(async () => (await overlay(page))?.spotlightOn).toBe('care-buttons');
  await expectNoTrap(page);
  await expectClearOfButtons(page);
  const pet = care.locator('[data-care="pet"]');
  await expect.poll(() => takesTaps(pet)).toBe(true);
  await tapOn(pet);
  await step('habitat');
  // #128: the next step waits behind the care sheet; Up close and All done
  // take their first tap.
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  await expectNoTrap(page);
  await expectClearOfButtons(page);
  await expect.poll(() => takesTaps(page.getByTestId('care-close-up')), slow).toBe(true);
  await expect.poll(() => takesTaps(page.getByTestId('care-close')), slow).toBe(true);
  await tapOn(page.getByTestId('care-close'));
  await expect(care).toBeHidden();
  // Still behind the home sheet; Back to map takes one tap, then Sprout speaks.
  expect((await overlay(page))?.held).toBe(true);
  await expect.poll(() => takesTaps(page.getByTestId('home-back')), slow).toBe(true);
  await tapOn(page.getByTestId('home-back'));
  await expect(page.getByTestId('home')).toBeHidden();
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(false);
  await expect(main).toBeVisible();
  await reloadAt('habitat', glade);

  // A habitat and a move-in through the API, land through the dev jump (a
  // claim's showdown can't be won on purpose), then the scripted night.
  const meadow = await api<{ buildings: { id: string; buildingId: string }[] }>(
    page,
    'POST',
    `/maps/${glade}/buildings`,
    { buildingId: 'cozy-meadow', q: home!.q, r: home!.r, spot: 2 },
  );
  expect(meadow.status).toBe(201);
  const meadowId = meadow.body.buildings.find((b) => b.buildingId === 'cozy-meadow')?.id;
  const partner = (await debug(page))?.stepId; // keep the hook warm for the poll below
  expect(partner).toBe('habitat');
  const state = await api<{ tutorial: { partner: { squishyId: string } | null } }>(
    page,
    'GET',
    '/tutorial',
  );
  const partnerId = state.body.tutorial.partner?.squishyId;
  expect(partnerId).toBeTruthy();
  const housed = await api(page, 'POST', `/maps/${glade}/squishies/${partnerId!}/habitat`, {
    habitatId: meadowId,
  });
  expect(housed.status).toBe(200);
  await step('territory');
  await reloadAt('territory', glade);
  expect((await api(page, 'POST', '/tutorial/dev/step', { stepId: 'nightfall' })).status).toBe(200);
  await step('nightfall');
  await reloadAt('nightfall', glade);
  await readAll();
  await expect(main).toHaveText('Night falls');
  await tapOn(main);
  await step('evolve');

  // #127 and #129: the lore page and the morning report come one at a time
  // (whichever lands first); Sprout waits behind both, and Okay! takes a
  // tap, after a reload too.
  const lore = page.getByTestId('lore-card');
  const okay = page.getByTestId('hollow-report-ok');
  await expect
    .poll(async () => (await lore.isVisible()) || (await okay.isVisible()), { timeout: 20_000 })
    .toBe(true);
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  let loreSeen = false;
  if (await lore.isVisible()) {
    loreSeen = true;
    expect((await hook<HollowDebug>(page, 'hollow'))?.report).toEqual([]);
    await expectNoTrap(page);
    await tapOn(lore.getByTestId('lore-close'));
    await expect(lore).toBeHidden();
  }
  await expect(okay).toBeVisible({ timeout: 20_000 });
  await expect(lore).toBeHidden();
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  await expectNoTrap(page);
  await expect.poll(() => takesTaps(okay), slow).toBe(true);
  await reloadAt('evolve', glade);
  // After the reload the page may come first (it waited behind the report before).
  await expect
    .poll(async () => (await lore.isVisible()) || (await okay.isVisible()), { timeout: 20_000 })
    .toBe(true);
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  if (await lore.isVisible()) {
    loreSeen = true;
    await expectNoTrap(page);
    await tapOn(lore.getByTestId('lore-close'));
    await expect(lore).toBeHidden();
  }
  await expect(okay).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  await expect.poll(() => takesTaps(okay), slow).toBe(true);
  // A tap on the orb peeks at Sprout, clear of the report; reading it
  // through and "Let's go!" tucks it back into the orb.
  await tapOn(bubble);
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(false);
  await expect(main).toBeVisible();
  await expect.poll(() => takesTaps(okay), slow).toBe(true);
  await expectNoTrap(page);
  await readAll();
  await expect(main).toHaveText("Let's go!");
  await tapOn(main);
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  await expect.poll(() => takesTaps(okay), slow).toBe(true);
  await tapOn(okay);
  await expect(okay).toBeHidden();
  if (!loreSeen) {
    // The page waited its turn behind the report; now it comes.
    await expect(lore).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
    await tapOn(lore.getByTestId('lore-close'));
    await expect(lore).toBeHidden();
  }
  // With the report gone, Sprout points at the Adventure handle again.
  await expect.poll(async () => (await overlay(page))?.gate).toBe('spotlight');
  expect((await overlay(page))?.spotlightOn).toBe('wild-squishy');

  // One more battle grows the Partner up; its "Whoa!" at home comes before
  // Sprout's "Wardrobe" (#129), and Yay! takes one tap.
  await wildBattle(glade, 'forfeit');
  await step('wardrobe');
  await reloadAt('wardrobe', glade);
  await openHome();
  const celebrate = page.getByTestId('care-celebrate');
  await expect(celebrate).toBeVisible(slow);
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(true);
  await expectNoTrap(page);
  const yay = page.getByTestId('care-yay');
  await expect.poll(() => takesTaps(yay), slow).toBe(true);
  await tapOn(yay);
  await expect(celebrate).toBeHidden();
  await tapOn(page.getByTestId('care-close'));
  await tapOn(page.getByTestId('home-back'));
  await expect(page.getByTestId('home')).toBeHidden();
  await expect.poll(async () => (await overlay(page))?.held, slow).toBe(false);
  await readAll();
  await expect(main).toHaveText('Wardrobe');
  await tapOn(main);
  const wardrobe = page.getByTestId('wardrobe');
  await expect(wardrobe).toBeVisible();
  await tapOn(wardrobe.getByRole('tab', { name: /Tops/ }));
  await tapOn(
    wardrobe.getByTestId('wardrobe-items').getByRole('button', { name: /Seedling Scarf/ }),
  );
  await step('graduation');
  await expect(wardrobe).toBeHidden();
  await reloadAt('graduation', glade);

  // Graduation: the two choices take taps; the care sheet never lingers over
  // the lobby's form, and the First Patch party comes alone (#129).
  await readAll();
  await expect.poll(async () => (await overlay(page))?.spotlightOn).toBe('graduation-choices');
  const choice = page
    .locator('[data-tutorial-target="graduation-choices"]')
    .getByRole('button', { name: 'Make a patch' });
  await expect.poll(() => takesTaps(choice), slow).toBe(true);
  await tapOn(choice);
  await expect(tutorial).toBeHidden();
  await expect(lobby.getByRole('heading', { name: 'Make a patch' })).toBeVisible();
  await expect(care).toBeHidden();
  // The party waits while the form the player asked for is on screen
  // (its first look is 1.5 s after the run ends), and comes once they leave it.
  const party = page.getByTestId('milestone-card');
  await page.waitForTimeout(2_500);
  await expect(party).toBeHidden();
  await tapOn(lobby.getByRole('button', { name: 'Back to my patches' }));
  await expect(party).toBeVisible({ timeout: 20_000 });
  await expect(party.getByTestId('milestone-name')).toHaveText('The First Patch');
  await expect(lore).toBeHidden();
  await expect.poll(() => takesTaps(party.getByTestId('milestone-yay')), slow).toBe(true);
  await tapOn(party.getByTestId('milestone-yay'));
  await expect(party).toBeHidden();
  expect((await debug(page))?.status).toBe('completed');
  // #163: no tutorial request was ever aborted.
  expect(aborted).toEqual([]);
}

test('The First Patch, every step tapped for real with a reload at each: Sprout never gets in the way', async ({
  browser,
}) => {
  test.setTimeout(900_000); // draws the Glade after every reload; CI renders in software
  const page = await newPlayer(browser, uniqueName('flow'));
  await playTutorial(page);
});

test('…and the same with a mouse on a desktop', async ({ browser }, testInfo) => {
  // Once is enough: the device projects differ only in touch and size.
  test.skip(!testInfo.project.name.startsWith('iphone'), 'runs once, from the iPhone project');
  test.setTimeout(900_000);
  const page = await desktopPlayer(browser, uniqueName('mouse'));
  await playTutorial(page);
});

/**
 * A new player on a 1440×900 desktop browser with a mouse and no touch
 * (players.ts signs up with touch taps, which need a touch screen).
 */
async function desktopPlayer(browser: Browser, name: string): Promise<Page> {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    ...(baseURL ? { baseURL } : {}),
  });
  const page = await context.newPage();
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await realTap(overlay.getByRole('button', { name: 'Sign up' }));
  await overlay.getByLabel('Family code').fill(process.env['HP_SIGNUP_CODE'] ?? '');
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill(TEST_PASSWORD);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await realTap(overlay.getByRole('button', { name: 'Sign up' }));
  await realTap(overlay.getByRole('button', { name: 'I saved it!' }));
  await skipCinematic(page);
  const picker = page.getByTestId('keeper-picker');
  await expect(picker.getByRole('heading', { name: 'Pick your Keeper!' })).toBeVisible();
  await realTap(picker.getByRole('button', { name: 'Clover', exact: true }));
  await realTap(picker.getByRole('button', { name: 'That’s me!' }));
  await expect(picker).toBeHidden();
  await expect(
    page.getByTestId('lobby').getByRole('heading', { name: 'Your patches' }),
  ).toBeVisible({ timeout: 15_000 });
  return page;
}
