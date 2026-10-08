import { expect, test, type Locator, type Page } from '@playwright/test';
import { api, hook, idle } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap, realTapAt, realTapThrough, restingBox } from './touch.js';
import { trayButton, traysState } from './trays.js';

/**
 * Single taps with a held press (touch.ts): down, a short hold, up, the
 * browser hit-testing both ends. Every control over the map and in its sheets
 * must do what its label says on the first tap, on an iPhone and an iPad
 * (both device projects run this file). The owner's playtest of 2026-10-05
 * found taps needing two tries and Collect not working; these are the
 * regression tests for that. Checked through the dev hook and the API, never
 * pixels. The press is the primary pointer, so iOS's own touch-to-click
 * synthesis is not what's under test here; a control rebuilt or moved under a
 * resting finger is.
 */

interface InventoryDebug {
  items: Record<string, number>;
  gathers: number;
  tileAction: string | null;
  chip: 'waiting' | 'ready' | null;
  toast: string | null;
  landings: number;
}
interface JobsDebug {
  board: { jobs: Record<string, string> };
}

const bagState = (page: Page) => hook<InventoryDebug>(page, 'inventory');
const mapState = (page: Page) => hook<{ id: string; live: string | null }>(page, 'map');
const itemTotal = (items: Record<string, number>) =>
  Object.values(items).reduce((a, b) => a + b, 0);

/** A new player on a fresh patch, with the map live. */
async function onAPatch(page: Page, name: string): Promise<string> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill(name);
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  return (await mapState(page))!.id;
}

/**
 * Taps (for real) around the Heart Seed until the tile panel offers Gather:
 * every home ring has nodes of ours (design doc §11).
 */
async function tapOwnNode(page: Page): Promise<void> {
  // Let the map settle first: picking a tile needs the scene drawn and the
  // camera's arrival glide over (both slow under software rendering in CI).
  await expect.poll(() => idle(page), { timeout: 60_000 }).toBe(true);
  const panel = page.getByTestId('tile-panel');
  const box = (await page.locator('#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const radius of [40, 60, 80, 100, 130]) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      // The panel from the last tap would swallow a tap landing on it (it
      // covers the lower half of a phone's screen): close it first, as a
      // player would.
      if (await panel.isVisible()) {
        await realTap(panel.getByRole('button', { name: 'Close' }));
        await expect(panel).toBeHidden();
      }
      await realTapAt(page, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      await expect
        .poll(async () => (await bagState(page))?.tileAction, { timeout: 1000 })
        .not.toBeNull()
        .catch(() => undefined);
      if ((await bagState(page))?.tileAction === 'gather') return;
    }
  }
  const map = await hook<{ selected: string | null; tiles: number; draws: number }>(page, 'map');
  throw new Error(
    `no node of ours near the Heart Seed (map ${JSON.stringify(map)}, bag ${JSON.stringify(await bagState(page))}, canvas ${JSON.stringify(box)})`,
  );
}

/** The button `testId`, with its tray opened by one real tap on the handle. */
const inTray = (page: Page, testId: string): Promise<Locator> =>
  trayButton(page, testId, (handle) => realTap(handle));

/** One real tap on `open` shows `sheet`; one real tap on its Close hides it. */
async function opensAndCloses(open: Locator, sheet: Locator, close: Locator): Promise<void> {
  await realTap(open);
  await expect(sheet).toBeVisible();
  await realTap(close);
  await expect(sheet).toBeHidden();
}

test('one real tap opens each sheet and works each button over the map', async ({ browser }) => {
  test.setTimeout(180_000); // a full map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('tap'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await onAPatch(page, 'Tappy Patch');

  // Sprout's first-time hint about the handles, if it's up: "Got it!".
  const hintOk = page.getByTestId('tray-hint-ok');
  if (await hintOk.isVisible()) await realTap(hintOk);

  // Each tray opens on one tap of its handle, and each entry inside on one tap.
  const bag = page.getByTestId('bag');
  await opensAndCloses(
    await inTray(page, 'bag-open'),
    bag,
    bag.getByRole('button', { name: 'Close' }),
  );
  await opensAndCloses(
    await inTray(page, 'catalog-open'),
    page.getByTestId('catalog'),
    page.getByTestId('catalog-close'),
  );
  const team = page.getByTestId('team');
  await opensAndCloses(
    await inTray(page, 'team-open'),
    team,
    team.getByRole('button', { name: 'Close' }),
  );
  const jobs = page.getByTestId('jobs');
  await opensAndCloses(
    await inTray(page, 'jobs-open'),
    jobs,
    jobs.getByRole('button', { name: 'Close' }),
  );
  const chat = page.getByTestId('chat');
  await opensAndCloses(page.getByTestId('chat-open'), chat, page.getByTestId('chat-close'));
  const hollow = page.getByTestId('hollow-sheet');
  await opensAndCloses(await inTray(page, 'hollow-open'), hollow, page.getByTestId('hollow-back'));
  const raids = page.getByTestId('raid-report');
  await opensAndCloses(
    await inTray(page, 'raid-open'),
    raids,
    raids.getByRole('button', { name: 'Close' }),
  );

  // Home owns the screen: Build opens the list, Cancel comes back, Back to map returns.
  await realTap(await inTray(page, 'home-open'));
  const home = page.getByTestId('home');
  await expect(home).toBeVisible();
  await realTap(page.getByTestId('home-build'));
  await expect(page.getByTestId('home-build-list')).toBeVisible();
  await realTap(home.getByRole('button', { name: 'Cancel' }));
  await expect(page.getByTestId('home-build')).toBeVisible();
  await realTap(page.getByTestId('home-back'));
  await expect(home).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText('Tappy Patch');
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');

  // A tile, then its panel's Close.
  await tapOwnNode(page);
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  await realTap(panel.getByRole('button', { name: 'Close' }));
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('gathers with one tap, and finished things land in the bag by themselves', async ({
  browser,
}) => {
  test.setTimeout(240_000); // two gathers, a job and a map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('coll'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const mapId = await onAPatch(page, 'Collect Patch');
  const panel = page.getByTestId('tile-panel');
  const bag = page.getByTestId('bag');
  const toast = page.getByTestId('landed-toast');

  // Gather on one of our nodes: one tap starts it.
  await tapOwnNode(page);
  const before = itemTotal((await bagState(page))!.items);
  await realTap(panel.getByTestId('tile-gather'));
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(1);
  await expect(panel.getByTestId('tile-gathering')).toBeVisible();
  await realTap(panel.getByRole('button', { name: 'Close' }));

  // It finishes (the dev route stands in for the wait, so the page's own
  // timer doesn't know): opening the Bag settles, and it lands with a pop-up.
  // No Collect anywhere (owner decision 2026-10-06).
  expect((await api(page, 'POST', `/maps/${mapId}/dev/gathers/ready`)).status).toBe(200);
  await realTap(await inTray(page, 'bag-open'));
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('+');
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(0);
  const afterTile = itemTotal((await bagState(page))!.items);
  expect(afterTile).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: 'Collect' })).toHaveCount(0);
  await realTap(bag.getByRole('button', { name: 'Close' }));
  await expect(page.getByTestId('gather-chip')).toBeHidden();

  // Again: the chip counts down, and a tap on it opens the Bag.
  await tapOwnNode(page);
  await realTap(panel.getByTestId('tile-gather'));
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(1);
  await realTap(panel.getByRole('button', { name: 'Close' }));
  const chip = page.getByTestId('gather-chip');
  await expect(chip).toContainText('Gathering');
  await realTap(chip);
  await expect(bag).toBeVisible();
  await realTap(bag.getByRole('button', { name: 'Close' }));
  await expect(bag).toBeHidden();
  // The same with the countdown ticking under the resting finger: the press
  // holds until the chip's words change, then lifts. WebKit drops a pointer's
  // click whose landing node (a label's Text node) is gone by the lift, which
  // is what a `textContent` rewrite does (CI's mouse, an iPad's trackpad,
  // Safari on a Mac; a finger on iOS presses and lifts in one go); the chip
  // rewrites its Text node in place, so one tap is one Bag whichever instant
  // the tick falls in.
  await realTapThrough(chip, async () => {
    // Read once the finger is down, so the change waited for falls inside the press.
    const ticking = (await chip.textContent()) ?? '';
    expect(ticking).toContain('Gathering');
    await expect(chip).not.toHaveText(ticking, { timeout: 15_000 });
  });
  await expect(bag).toBeVisible();
  await realTap(bag.getByRole('button', { name: 'Close' }));
  // Done: the app coming back to the front settles too, and the chip goes.
  expect((await api(page, 'POST', `/maps/${mapId}/dev/gathers/ready`)).status).toBe(200);
  const landed = (await bagState(page))!.landings;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(async () => (await bagState(page))?.landings).toBe(landed + 1);
  await expect(chip).toBeHidden();
  await expect(toast).toBeVisible();
  expect(itemTotal((await bagState(page))!.items)).toBeGreaterThan(afterTile);

  // A squishy gatherer's work lands by itself too: the job board settles
  // before it reads the server's view.
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'mossmuffin',
    level: 4,
  });
  expect(granted.status).toBe(201);
  const helperId = (granted.body as { squishy: { id: string } }).squishy.id;
  await realTap(await inTray(page, 'jobs-open'));
  const board = page.getByTestId('jobs');
  const helper = board.locator(`[data-testid="jobs-row"][data-squishy="${helperId}"]`);
  await realTap(helper.getByRole('button', { name: /Gather/ }));
  await realTap(helper.getByTestId('jobs-picker').getByTestId('jobs-spot').first());
  // The board takes the server's answer (one round trip; roomy under CI load).
  await expect
    .poll(async () => (await hook<JobsDebug>(page, 'jobs'))?.board.jobs[helperId], {
      timeout: 15_000,
    })
    .toBe('gatherer');
  expect((await api(page, 'POST', `/maps/${mapId}/dev/work/ready`)).status).toBe(200);
  await realTap(board.getByRole('button', { name: 'Close' }));
  const bagBeforeJobs = itemTotal((await bagState(page))!.items);
  const landedBefore = (await bagState(page))!.landings;
  await realTap(await inTray(page, 'jobs-open'));
  await expect.poll(async () => (await bagState(page))?.landings).toBe(landedBefore + 1);
  await expect(toast).toBeVisible();
  expect(itemTotal((await bagState(page))!.items)).toBeGreaterThan(bagBeforeJobs);
  await expect(board.getByRole('button', { name: /Collect/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a battle action lands on one tap', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('hit'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await onAPatch(page, 'Showdown Taps');

  await realTap(await inTray(page, 'battle-dev-grant'));
  await realTap(await inTray(page, 'battle-dev-fight'));
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  const move = page.getByTestId('battle-move').first();
  await expect(move).toBeEnabled({ timeout: 30_000 });
  const turn = (await hook<{ turn: number }>(page, 'battle'))!.turn;
  await realTap(move);
  await expect
    .poll(async () => (await hook<{ turn: number }>(page, 'battle'))?.turn, { timeout: 30_000 })
    .not.toBe(turn);
  expect(errors).toEqual([]);
});

test('Home and Bag open on the first tap while a tile panel is open', async ({ browser }) => {
  // #165: before the trays, both buttons left the screen while a tile was
  // selected, so the first click landed on the map and only the second one
  // acted. They live in the My Home tray now and never hide under a
  // panel: one tap on the handle, one tap on the entry, with the panel open.
  test.setTimeout(240_000); // two map builds (Home and back) and two tile sweeps
  const page = await newPlayer(browser, uniqueName('open'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await onAPatch(page, 'Open Patch');
  const hintOk = page.getByTestId('tray-hint-ok');
  if (await hintOk.isVisible()) await realTap(hintOk);
  const panel = page.getByTestId('tile-panel');

  await tapOwnNode(page);
  await expect(panel).toBeVisible();
  const homeEntry = await inTray(page, 'home-open');
  await expect(homeEntry).toBeVisible();
  await realTap(homeEntry);
  // Home fetches itself before it shows; roomy under CI load.
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 15_000 });
  expect((await hook<{ open: boolean }>(page, 'home'))?.open).toBe(true);
  await realTap(page.getByTestId('home-back'));
  await expect(page.getByTestId('home')).toBeHidden();
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');

  await tapOwnNode(page);
  await expect(panel).toBeVisible();
  const bagEntry = await inTray(page, 'bag-open');
  await expect(bagEntry).toBeVisible();
  await realTap(bagEntry);
  const bag = page.getByTestId('bag');
  await expect(bag).toBeVisible();
  await realTap(bag.getByRole('button', { name: 'Close' }));
  await expect(bag).toBeHidden();
  expect(errors).toEqual([]);
});

test('a tap sticks to a button that moves under the finger (a tray mid-slide)', async ({
  browser,
}) => {
  // A kid taps the Bag the moment it appears, while its tray is still
  // sliding: by the lift the entry has moved on, so the browser's own click
  // goes to whatever is under the lift (or nowhere, on iOS). The tap sticks
  // to the button it landed on (ui/sticky-taps.ts): one Bag. The slide is
  // replayed by hand here (the tray moved while the finger is down), so the
  // press lands mid-slide on every machine, however fast it draws.
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('slide'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await onAPatch(page, 'Quick Patch');
  const hintOk = page.getByTestId('tray-hint-ok');
  if (await hintOk.isVisible()) await realTap(hintOk);
  await page.evaluate(() => {
    const w = window as unknown as { __bagClicks: number };
    w.__bagClicks = 0;
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target instanceof Element ? e.target.closest('[data-testid="bag-open"]') : null;
        if (t) w.__bagClicks += 1;
      },
      true,
    );
  });

  const entry = await inTray(page, 'bag-open');
  // The tray is put at its resting place by hand (its slide would get there
  // anyway, slowly on a software-drawn CI). Then, in one go inside the page,
  // a finger lands near the entry's left edge, the tray jumps on by 120 px
  // to the right under the resting finger, as the tail of a slide would, and
  // the finger lifts. Played in the page, the press takes no time however
  // slow the runner is, so it is always a tap (TAP_MAX_MS) and lands
  // mid-slide on every machine. The browser makes no click of its own for
  // these events, so the one Bag click is sticky-taps' own.
  const tray = page.locator('.tray.tray-heartpatch');
  const bag = page.getByTestId('bag');
  await tray.evaluate((node: HTMLElement) => {
    node.style.transition = 'none';
    node.style.transform = 'none';
  });
  const box = await restingBox(entry);
  const moved = await tray.evaluate(
    (node: HTMLElement, at: { x: number; y: number }) => {
      const finger = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: at.x,
        clientY: at.y,
      };
      const entry = node.querySelector('[data-testid="bag-open"]')!;
      const before = entry.getBoundingClientRect().x;
      // A touch keeps its first target (implicit capture): the lift goes there too.
      const pressed = document.elementFromPoint(at.x, at.y)!;
      pressed.dispatchEvent(new PointerEvent('pointerdown', finger));
      node.style.transform = 'translateX(120px)';
      const after = entry.getBoundingClientRect().x;
      pressed.dispatchEvent(new PointerEvent('pointerup', { ...finger, buttons: 0 }));
      node.style.removeProperty('transform');
      node.style.removeProperty('transition');
      return after - before;
    },
    { x: box.x + 8, y: box.y + box.height / 2 },
  );
  // The entry really was out from under the finger at the lift.
  expect(moved).toBeGreaterThan(100);

  await expect(bag).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __bagClicks: number }).__bagClicks))
    .toBe(1);
  // One action: the entry shut its tray, as a tap on it does.
  await expect.poll(async () => (await traysState(page))?.open).toBeNull();
  await realTap(bag.getByRole('button', { name: 'Close' }));
  expect(errors).toEqual([]);
});
