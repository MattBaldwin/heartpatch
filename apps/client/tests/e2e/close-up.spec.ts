import { CARE_RULES, findAvoidedWords, GAME_DATA } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { freshResize, holdResizes, still, turnLikeIos } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

/**
 * The close-up view (#20): open a squishy face to face from home base, boop,
 * stroke, tickle and drag a treat over, rename it, and swipe back. Gestures
 * are pointer events at the squishy's spot on screen (from the dev hook, which
 * works it out from the camera, not pixels: WebKit headless has no GPU), and
 * every check is on game state, never pixels or timing.
 */

interface Target {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

interface CloseUpDebug {
  squishyId: string;
  from: 'home' | 'map';
  phase: 'arriving' | 'here' | 'leaving';
  scene: { squishies: number; backdrop: boolean } | null;
  target: Target | null;
  sent: number;
  held: number;
  lastHold: string | null;
  reactions: number;
  contentment: number | null;
  caredToday: number | null;
  nickname: string | null;
  celebrating: boolean;
  drawnSpecies: string | null;
  note: string;
}

const state = (page: Page) => hook<CloseUpDebug>(page, 'closeUp');
const homeOpen = async (page: Page) => (await hook<{ open: boolean }>(page, 'home'))?.open ?? false;
const mapOpen = async (page: Page) => (await hook<{ id: string }>(page, 'map'))?.id ?? null;

/** A fresh player on their own patch with a squishy friend and a bag of stuff (dev tools). */
async function playerWithFriend(page: Page): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Close Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await (await trayButton(page, 'bag-open')).tap();
  await page.getByTestId('bag').getByRole('button', { name: 'Get stuff (dev)' }).tap();
  await slowExpect(page.getByTestId('bag').locator('[data-item="treats"]')).toContainText('10');
  await page.getByTestId('bag').getByRole('button', { name: 'Close' }).tap();
  await (await trayButton(page, 'battle-dev-grant')).tap();
  await slowExpect(page.locator('.battle-entry-note')).toContainText('joined you');
}

/** Opens the first squishy up close from its care sheet at home base. */
async function openFromHome(page: Page): Promise<CloseUpDebug> {
  await (await trayButton(page, 'home-open')).tap();
  await expect.poll(() => homeOpen(page), slow).toBe(true);
  await page.getByTestId('home-friends').locator('[data-care-squishy]').first().tap();
  await slowExpect(page.getByTestId('care')).toBeVisible();
  await page.getByTestId('care-close-up').tap();
  await expect.poll(async () => (await state(page))?.phase, slow).toBe('here');
  const shown = (await state(page))!;
  expect(shown.target).not.toBeNull();
  return shown;
}

type PointerStep = readonly [type: string, id: number, x: number, y: number];

/**
 * One gesture's pointer events on an element (CSS pixels), dispatched in one
 * task in the page, so a slow software-rendered runner can't stretch a quick
 * tap past the tap window between round trips.
 */
async function gesture(page: Page, testId: string, steps: readonly PointerStep[], css = '') {
  await page.evaluate(
    ({ selector, steps }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`no ${selector}`);
      for (const [type, id, x, y] of steps) {
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 1,
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
      }
    },
    { selector: `[data-testid="${testId}"]${css}`, steps },
  );
}

const tap = (x: number, y: number): PointerStep[] => [
  ['pointerdown', 1, x, y],
  ['pointerup', 1, x, y],
];

/** Waits until `n` care actions were sent and every reply has landed. */
async function sentAndSettled(page: Page, n: number, contentment: number) {
  await expect.poll(async () => (await state(page))?.sent, slow).toBe(n);
  await expect.poll(async () => (await state(page))?.contentment, slow).toBe(contentment);
}

test('cares up close with gestures, renames, and swipes back home', async ({ browser }) => {
  test.setTimeout(240_000); // two scene builds plus the starter screen; CI renders in software
  const page = await newPlayer(browser, uniqueName('close'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await playerWithFriend(page);
  // Each care reply keeps its action resting for a minute (the server's own
  // debounce is 10 s, covered by its tests), so "still resting" below doesn't
  // depend on how fast this runner is.
  const resting = new Map<string, string>();
  await page.route('**/api/v1/maps/*/squishies/*/care', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      result?: { action: string; squishyId: string };
      squishies: { id: string; nextCareAt: Record<string, string> }[];
    };
    const done = body.result;
    if (done) resting.set(done.action, new Date(Date.now() + 60_000).toISOString());
    const cared = done ? body.squishies.find((s) => s.id === done.squishyId) : undefined;
    if (cared) Object.assign(cared.nextCareAt, Object.fromEntries(resting));
    await route.fulfill({ response, json: body });
  });
  const opened = await openFromHome(page);
  // A new squishy starts part content (care rules `startContentment`).
  const start = CARE_RULES.startContentment;
  expect(opened).toMatchObject({ from: 'home', sent: 0, contentment: start });
  expect(opened.scene?.squishies).toBe(1);
  // The care sheet stepped out; the close-up owns the screen.
  await slowExpect(page.getByTestId('care')).toBeHidden();
  const t = opened.target!;

  // Boop: play counts on the server.
  await gesture(page, 'close-up-touch', tap(t.x, t.y));
  await sentAndSettled(page, 1, start + 10);
  await slowExpect(page.getByTestId('close-up-note')).toContainText('Boop!');

  // Another boop: the squishy still reacts, but play is resting, so nothing
  // is sent (the server would only say "a tiny moment").
  const before = (await state(page))!;
  await gesture(page, 'close-up-touch', tap(t.x, t.y));
  await expect.poll(async () => (await state(page))?.held, slow).toBe(before.held + 1);
  expect(await state(page)).toMatchObject({
    sent: 1,
    lastHold: 'resting',
    reactions: before.reactions + 1,
  });

  // Stroke across it: pet.
  const left = t.x - t.rx * 0.6;
  await gesture(page, 'close-up-touch', [
    ['pointerdown', 1, left, t.y],
    ...Array.from({ length: 12 }, (_, i): PointerStep => {
      return ['pointermove', 1, left + (t.rx * 1.2 * (i + 1)) / 12, t.y];
    }),
    ['pointerup', 1, t.x + t.rx * 0.6, t.y],
  ]);
  await sentAndSettled(page, 2, start + 20);

  // Pinch to tickle: play again, still resting, so it's a giggle and nothing sent.
  await gesture(page, 'close-up-touch', [
    ['pointerdown', 1, t.x - 20, t.y],
    ['pointerdown', 2, t.x + 20, t.y],
    ['pointermove', 1, t.x - 60, t.y],
    ['pointermove', 2, t.x + 60, t.y],
    ['pointerup', 1, t.x - 60, t.y],
    ['pointerup', 2, t.x + 60, t.y],
  ]);
  await expect.poll(async () => (await state(page))?.held, slow).toBe(before.held + 2);
  expect((await state(page))?.sent).toBe(2);

  // Drag a treat from Feed onto the squishy: feed, one Treat spent.
  const feed = page.getByTestId('close-up').locator('[data-care="feed"]');
  await slowExpect(feed).toContainText('10 Treats');
  const box = (await feed.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await gesture(
    page,
    'close-up',
    [
      ['pointerdown', 7, at.x, at.y],
      ['pointermove', 7, at.x, at.y - 40],
      ['pointermove', 7, t.x, t.y],
      ['pointerup', 7, t.x, t.y],
    ],
    ' [data-care="feed"]',
  );
  await sentAndSettled(page, 3, start + 40);
  await slowExpect(feed).toContainText('9 Treats');
  expect((await state(page))?.caredToday).toBe(3);

  // The info card: the rarity chip under the name (#240), then open About and
  // rename (the server filters every name).
  const view = page.getByTestId('close-up');
  await slowExpect(view.getByTestId('close-up-rarity')).toHaveText(
    /^(Common|Uncommon|Rare|Epic|Legendary|Secret)$/,
  );
  await view.getByTestId('close-up-about').locator('summary').tap();
  await slowExpect(view.getByTestId('close-up-facts')).toContainText('Feeling');
  await view.getByTestId('close-up-rename-open').tap();
  await view.getByTestId('close-up-rename-input').fill('Sir Puffs');
  await view.getByTestId('close-up-rename-save').tap();
  await expect.poll(async () => (await state(page))?.nickname, slow).toBe('Sir Puffs');
  await slowExpect(page.locator('#close-up-title')).toHaveText('Sir Puffs');
  await slowExpect(page.getByTestId('close-up-note')).toContainText('Hello, Sir Puffs!');

  // Kid-friendly words only (style guide §9).
  expect(findAvoidedWords((await view.textContent()) ?? '')).toEqual([]);

  // Swipe down from the top to go back home.
  await gesture(page, 'close-up-touch', [
    ['pointerdown', 1, t.x, 40],
    ['pointermove', 1, t.x, 120],
    ['pointerup', 1, t.x, 220],
  ]);
  await expect.poll(() => state(page), slow).toBeNull();
  await expect.poll(() => homeOpen(page), slow).toBe(true);
  await slowExpect(view).toBeHidden();
  // Home base shows the new name.
  await slowExpect(page.getByTestId('home-friends')).toContainText('Sir Puffs');
  expect(errors).toEqual([]);
  // Don't leave this player's page drawing while later specs run.
  await page.context().close();
});

test('celebrates an evolution in the close-up, and Back returns to the map', async ({
  browser,
}) => {
  test.setTimeout(240_000); // two scene builds plus the starter screen; CI renders in software
  const page = await newPlayer(browser, uniqueName('closeevo'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await playerWithFriend(page);

  // The squishy is a friend in the catalog (a dev grant doesn't fill it in),
  // so its card opens the care sheet over the map.
  const mapId = (await mapOpen(page))!;
  const { body: care } = await api<{
    squishies: { speciesId: string }[];
    speciesDefs: { id: string }[];
  }>(page, 'GET', `/maps/${mapId}/care`);
  const speciesId = care.squishies[0]!.speciesId;
  const def = care.speciesDefs.find((s) => s.id === speciesId);
  await page.route('**/api/v1/maps/*/catalog', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      catalog: { entries: unknown[]; speciesDefs: unknown[] };
    };
    const at = new Date().toISOString();
    body.catalog.entries.push({ speciesId, firstSeenAt: at, firstCaughtAt: at });
    if (def) body.catalog.speciesDefs.push(def);
    await route.fulfill({ response, json: body });
  });
  await (await trayButton(page, 'catalog-open')).tap();
  await page.locator(`[data-care-species="${speciesId}"]`).tap();
  await slowExpect(page.getByTestId('care')).toBeVisible();

  // What the care list says next (levelling takes many battles, so it is
  // told an evolution just happened; the server's own is in its tests):
  // one waiting to be celebrated, then a new form, then the squishy gone.
  const otherForm = GAME_DATA.species.find((s) => s.id !== speciesId)!;
  let mode: 'evolved' | 'real' | 'new-form' | 'gone' = 'evolved';
  await page.route('**/api/v1/maps/*/care', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      squishies: { speciesId: string; newEvolution: unknown }[];
    };
    const first = body.squishies[0];
    if (first && mode === 'evolved') {
      mode = 'real';
      first.newEvolution = {
        fromSpeciesId: first.speciesId,
        intoSpeciesId: first.speciesId,
        level: 20,
        at: new Date().toISOString(),
      };
    } else if (first && mode === 'new-form') {
      first.speciesId = otherForm.id;
    } else if (mode === 'gone') {
      body.squishies = [];
    }
    await route.fulfill({ response, json: body });
  });
  /** Coming back to the app refetches the care list. */
  const comeBack = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByTestId('care-close-up').tap();
  await expect.poll(async () => (await state(page))?.celebrating, slow).toBe(true);
  expect((await state(page))?.from).toBe('map');
  await slowExpect(page.getByTestId('close-up-celebrate')).toContainText('grew into');
  await page.getByTestId('close-up-yay').tap();
  await expect.poll(async () => (await state(page))?.celebrating, slow).toBe(false);
  expect((await state(page))?.drawnSpecies).toBe(speciesId);

  // It grew into a new form while up close: the 3D squishy is redrawn as it.
  mode = 'new-form';
  await comeBack();
  await expect.poll(async () => (await state(page))?.drawnSpecies, slow).toBe(otherForm.id);
  await expect.poll(async () => (await state(page))?.scene?.squishies, slow).toBe(1);

  // Back: swoops out and the map comes back.
  mode = 'real';
  await page.getByTestId('close-up-back').tap();
  await expect.poll(() => state(page), slow).toBeNull();
  await expect.poll(() => mapOpen(page), slow).toBe(mapId);
  await slowExpect(page.getByTestId('tray-handle-adventure')).toBeVisible();

  // Up close again, and it leaves (taken to the Hollow overnight): it says
  // so with the card up, then swoops back to the map by itself.
  await (await trayButton(page, 'catalog-open')).tap();
  await page.locator(`[data-care-species="${speciesId}"]`).tap();
  await page.getByTestId('care-close-up').tap();
  await expect.poll(async () => (await state(page))?.phase, slow).toBe('here');
  mode = 'gone';
  await comeBack();
  await slowExpect(page.getByTestId('close-up-note')).toContainText('wandered off');
  await expect.poll(() => state(page), slow).toBeNull();
  await expect.poll(() => mapOpen(page), slow).toBe(mapId);
  expect(errors).toEqual([]);
  // Don't leave this player's page drawing while later specs run.
  await page.context().close();
});

test('keeps the squishy framed when the phone turns (#263)', async ({ browser }) => {
  test.setTimeout(240_000); // a map build and the close-up; CI renders in software
  const page = await newPlayer(browser, uniqueName('turncu'));
  await holdResizes(page);
  await playerWithFriend(page);
  await openFromHome(page);

  // Where the squishy sits once the turned layout has settled.
  const framed = async () => {
    await still(page, '[data-testid="close-up-touch"], [data-testid="close-up"] .close-up-card');
    return (await state(page))!.target!;
  };
  await turnLikeIos(page);
  const turned = await framed();
  // A resize the screen hears now measures afresh: the framing it gives is
  // what the turn should already have.
  await freshResize(page);
  const fresh = await framed();
  for (const key of ['x', 'y', 'rx', 'ry'] as const) {
    expect(Math.abs(turned[key] - fresh[key]), key).toBeLessThan(4);
  }
});
