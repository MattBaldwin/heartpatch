import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

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
  note: string;
}

type Hook = {
  __heartpatch?: {
    closeUp?(): CloseUpDebug | null;
    home?(): { open: boolean } | null;
    map?(): { id: string } | null;
    care?(): { open: boolean } | null;
  };
};

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.closeUp?.() ?? null);
const homeOpen = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.home?.()?.open ?? false);
const mapOpen = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.()?.id ?? null);

/** A fresh player on their own patch with a squishy friend and a bag of stuff (dev tools). */
async function playerWithFriend(page: Page): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Close Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await slowExpect(lobby).toBeHidden();
  await page.getByTestId('bag-open').tap();
  await page.getByTestId('bag').getByRole('button', { name: 'Get stuff (dev)' }).tap();
  await slowExpect(page.getByTestId('bag').locator('[data-item="treats"]')).toContainText('10');
  await page.getByTestId('bag').getByRole('button', { name: 'Close' }).tap();
  await page.getByTestId('battle-dev-grant').tap();
  await slowExpect(page.locator('.battle-entry-note')).toContainText('joined you');
}

/** Opens the first squishy up close from its care sheet at home base. */
async function openFromHome(page: Page): Promise<CloseUpDebug> {
  await page.getByTestId('home-open').tap();
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
  test.setTimeout(150_000);
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
  expect(opened).toMatchObject({ from: 'home', sent: 0, contentment: 0 });
  expect(opened.scene?.squishies).toBe(1);
  // The care sheet stepped out; the close-up owns the screen.
  await slowExpect(page.getByTestId('care')).toBeHidden();
  const t = opened.target!;

  // Boop: play counts on the server.
  await gesture(page, 'close-up-touch', tap(t.x, t.y));
  await sentAndSettled(page, 1, 10);
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
  await sentAndSettled(page, 2, 20);

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
  await sentAndSettled(page, 3, 40);
  await slowExpect(feed).toContainText('9 Treats');
  expect((await state(page))?.caredToday).toBe(3);

  // The info card: open About, then rename (the server filters every name).
  const view = page.getByTestId('close-up');
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
});

test('celebrates an evolution in the close-up, and Back returns to the map', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const page = await newPlayer(browser, uniqueName('closeevo'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await playerWithFriend(page);

  // The squishy is a friend in the catalog (a dev grant doesn't fill it in),
  // so its card opens the care sheet over the map.
  const mapId = (await mapOpen(page))!;
  const care = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/maps/${id}/care`);
    return (await res.json()) as {
      squishies: { speciesId: string }[];
      speciesDefs: { id: string }[];
    };
  }, mapId);
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
  await page.getByTestId('catalog-open').tap();
  await page.locator(`[data-care-species="${speciesId}"]`).tap();
  await slowExpect(page.getByTestId('care')).toBeVisible();

  // An evolution lands while it's up close (levelling takes many battles, so
  // the care list says one just happened; the server's own is in its tests).
  let evolved = false;
  await page.route('**/api/v1/maps/*/care', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      squishies: { speciesId: string; newEvolution: unknown }[];
    };
    const first = body.squishies[0];
    if (first && !evolved) {
      evolved = true;
      first.newEvolution = {
        fromSpeciesId: first.speciesId,
        intoSpeciesId: first.speciesId,
        level: 20,
        at: new Date().toISOString(),
      };
    }
    await route.fulfill({ response, json: body });
  });
  await page.getByTestId('care-close-up').tap();
  await expect.poll(async () => (await state(page))?.celebrating, slow).toBe(true);
  expect((await state(page))?.from).toBe('map');
  await slowExpect(page.getByTestId('close-up-celebrate')).toContainText('grew into');
  await page.getByTestId('close-up-yay').tap();
  await expect.poll(async () => (await state(page))?.celebrating, slow).toBe(false);

  // Back: swoops out and the map comes back.
  await page.getByTestId('close-up-back').tap();
  await expect.poll(() => state(page), slow).toBeNull();
  await expect.poll(() => mapOpen(page), slow).toBe(mapId);
  await slowExpect(page.getByTestId('battle-entry')).toBeVisible();
  expect(errors).toEqual([]);
});
