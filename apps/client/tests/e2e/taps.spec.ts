import { expect, test, type Locator, type Page } from '@playwright/test';
import { api, hook, idle } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap, realTapAt } from './touch.js';

/**
 * Single taps, the way a finger does them (touch.ts): down, a short hold, up.
 * Every control over the map and in its sheets must work on the first tap,
 * on an iPhone and an iPad (both device projects run this file). The owner's
 * playtest of 2026-10-05 found taps needing two tries and Collect not
 * working; these are the regression tests for that. Checked through the dev
 * hook and the API, never pixels.
 */

interface InventoryDebug {
  items: Record<string, number>;
  gathers: number;
  tileAction: string | null;
  chip: 'waiting' | 'ready' | null;
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
 * Taps (for real) around the Heart Seed until the tile panel offers Gather
 * (or Collect, for the node gathered earlier): every home ring has nodes of
 * ours (design doc §11).
 */
async function tapOwnNode(page: Page, offering: 'gather' | 'collect' = 'gather'): Promise<void> {
  // Let the map settle first: picking a tile needs the scene drawn and the
  // camera's arrival glide over (both slow under software rendering in CI).
  await expect.poll(() => idle(page), { timeout: 60_000 }).toBe(true);
  const box = (await page.locator('#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const radius of [40, 60, 80, 100, 130]) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      await realTapAt(page, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      await expect
        .poll(async () => (await bagState(page))?.tileAction, { timeout: 2000 })
        .not.toBeNull()
        .catch(() => undefined);
      if ((await bagState(page))?.tileAction === offering) return;
    }
  }
  throw new Error('no node of ours near the Heart Seed');
}

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

  const bag = page.getByTestId('bag');
  await opensAndCloses(
    page.getByTestId('bag-open'),
    bag,
    bag.getByRole('button', { name: 'Close' }),
  );
  await opensAndCloses(
    page.getByTestId('catalog-open'),
    page.getByTestId('catalog'),
    page.getByTestId('catalog-close'),
  );
  const team = page.getByTestId('team');
  await opensAndCloses(
    page.getByTestId('team-open'),
    team,
    team.getByRole('button', { name: 'Close' }),
  );
  const jobs = page.getByTestId('jobs');
  await opensAndCloses(
    page.getByTestId('jobs-open'),
    jobs,
    jobs.getByRole('button', { name: 'Close' }),
  );
  const chat = page.getByTestId('chat');
  await opensAndCloses(page.getByTestId('chat-open'), chat, page.getByTestId('chat-close'));
  const hollow = page.getByTestId('hollow-sheet');
  await opensAndCloses(page.getByTestId('hollow-open'), hollow, page.getByTestId('hollow-back'));
  const raids = page.getByTestId('raid-report');
  await opensAndCloses(
    page.getByTestId('raid-open'),
    raids,
    raids.getByRole('button', { name: 'Close' }),
  );

  // Home owns the screen: Build opens the list, Cancel comes back, Back to map returns.
  await realTap(page.getByTestId('home-open'));
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

test('gathers and collects with one tap each, and the bag fills up', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('coll'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const mapId = await onAPatch(page, 'Collect Patch');
  const panel = page.getByTestId('tile-panel');
  const bag = page.getByTestId('bag');

  // Gather on one of our nodes: one tap starts it.
  await tapOwnNode(page);
  const before = itemTotal((await bagState(page))!.items);
  await realTap(panel.getByTestId('tile-gather'));
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(1);
  await expect(panel.getByTestId('tile-gathering')).toBeVisible();
  await realTap(panel.getByRole('button', { name: 'Close' }));

  // It finishes (the dev route stands in for the wait). The chip says so once
  // the bag has heard: opening the Bag refetches it.
  expect((await api(page, 'POST', `/maps/${mapId}/dev/gathers/ready`)).status).toBe(200);
  await realTap(page.getByTestId('bag-open'));
  await expect(bag.getByTestId('bag-collect')).toBeVisible();
  await realTap(bag.getByRole('button', { name: 'Close' }));
  await expect.poll(async () => (await bagState(page))?.chip).toBe('ready');

  // The tile panel offers Collect: one tap puts it in the bag.
  await tapOwnNode(page, 'collect');
  await expect(panel.getByTestId('tile-collect')).toBeVisible();
  await realTap(panel.getByTestId('tile-collect'));
  await expect(page.getByTestId('bag-note')).toContainText('Yay!');
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(0);
  const afterTile = itemTotal((await bagState(page))!.items);
  expect(afterTile).toBeGreaterThan(before);
  expect((await bagState(page))?.tileAction).toBe('gather');

  // Again, this time collecting from the chip's Bag ("Tap to collect").
  await realTap(panel.getByTestId('tile-gather'));
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(1);
  await realTap(panel.getByRole('button', { name: 'Close' }));
  expect((await api(page, 'POST', `/maps/${mapId}/dev/gathers/ready`)).status).toBe(200);
  await realTap(page.getByTestId('gather-chip'));
  await expect(bag).toBeVisible();
  await realTap(bag.getByTestId('bag-collect'));
  await expect(page.getByTestId('bag-note')).toContainText('Yay!');
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(0);
  expect(itemTotal((await bagState(page))!.items)).toBeGreaterThan(afterTile);
  await realTap(bag.getByRole('button', { name: 'Close' }));

  // A squishy gatherer's work: the job board's Collect, one tap.
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'mossmuffin',
    level: 4,
  });
  expect(granted.status).toBe(201);
  const helperId = (granted.body as { squishy: { id: string } }).squishy.id;
  await realTap(page.getByTestId('jobs-open'));
  const board = page.getByTestId('jobs');
  const helper = board.locator(`[data-testid="jobs-row"][data-squishy="${helperId}"]`);
  await realTap(helper.getByRole('button', { name: /Gather/ }));
  await realTap(helper.getByTestId('jobs-picker').getByTestId('jobs-spot').first());
  await expect
    .poll(async () => (await hook<JobsDebug>(page, 'jobs'))?.board.jobs[helperId])
    .toBe('gatherer');
  expect((await api(page, 'POST', `/maps/${mapId}/dev/work/ready`)).status).toBe(200);
  await realTap(board.getByRole('button', { name: 'Close' }));
  await realTap(page.getByTestId('jobs-open'));
  const bagBeforeJobs = (await api(page, 'GET', `/maps/${mapId}/inventory`)).body as {
    items: Record<string, number>;
  };
  await realTap(board.getByTestId('jobs-collect'));
  await expect(board.getByTestId('jobs-note')).toContainText('+');
  const bagAfterJobs = (await api(page, 'GET', `/maps/${mapId}/inventory`)).body as {
    items: Record<string, number>;
  };
  expect(itemTotal(bagAfterJobs.items)).toBeGreaterThan(itemTotal(bagBeforeJobs.items));
  expect(errors).toEqual([]);
});

test('a battle action lands on one tap', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('hit'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await onAPatch(page, 'Showdown Taps');

  await realTap(page.getByTestId('battle-dev-grant'));
  await realTap(page.getByTestId('battle-dev-fight'));
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
