import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Finding a rare one (#391): a rare-or-better wild squishy gets its moment
 * the first time the player meets its kind, and a short banner after. The
 * battle clock is held (`?battle-clock=manual`), so the moment stays up until
 * the test moves it on, however slow the renderer. Checked through the page's
 * elements, the dev hook and the API, never pixels.
 */

interface BattleDebug {
  id: string;
  status: 'active' | 'finished' | 'no-contest';
  turn: number;
  waiting: boolean;
}
const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');

/** WebKit's page error for an in-flight API fetch a navigation aborts (as in hollow.spec.ts). */
const ABORTED_FETCH = /\/api\/v1\/\S* due to access control checks\.?$/;
/** True while `meet` reloads the page: only then may an aborted fetch go by. */
let reloading = false;

/** Moves the held battle clock on (`BattleScreen.dev`). */
async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((step) => {
    const hook = (window as { __heartpatch?: { battleDev?: () => unknown } }).__heartpatch;
    const dev = hook?.battleDev?.() as { advance: (ms: number) => void } | null | undefined;
    if (!dev) throw new Error('no held battle clock: open the page with ?battle-clock=manual');
    dev.advance(step);
  }, ms);
}

/**
 * Starts a wild battle against `speciesId` and opens the page with the clock
 * held: the battle the player is in resumes on the map, through the same
 * door as one just found.
 */
async function meet(page: Page, mapId: string, speciesId: string): Promise<string> {
  const started = await api<{ battle: { id: string } }>(
    page,
    'POST',
    `/maps/${mapId}/dev/battles`,
    {
      opponent: { speciesId, level: 3 },
    },
  );
  expect(started.status).toBe(201);
  reloading = true;
  try {
    await page.goto('/?battle-clock=manual');
    await expect(page.getByTestId('battle-hud')).toBeVisible({ timeout: 60_000 });
  } finally {
    reloading = false;
  }
  await expect.poll(() => battleState(page).then((s) => s?.id)).toBe(started.body.battle.id);
  return started.body.battle.id;
}

/** Scoots home through the API (the held clock would hold the run-away playback too). */
async function forfeit(page: Page, battleId: string): Promise<void> {
  const res = await api(page, 'POST', `/battles/${battleId}/actions`, {
    action: { type: 'forfeit' },
    turn: 0,
  });
  expect(res.status).toBe(200);
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('a rare find gets its moment the first time, and just a banner after (#391)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('rare'));
  const errors: string[] = [];
  // Only an API fetch a reload in `meet` aborts (on CI: "…/api/v1/lore due to
  // access control checks.") is let through, and only while reloading; every
  // other page error stays fatal.
  page.on('pageerror', (err) => {
    if (reloading && ABORTED_FETCH.test(err.message)) return;
    errors.push(err.message);
  });

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Rare Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  const mapIdOf = async () => (await hook<{ id: string }>(page, 'map'))?.id ?? '';
  await expect.poll(mapIdOf, { timeout: 30_000 }).not.toBe('');
  const mapId = await mapIdOf();

  // First meeting with a Rare kind: the whole moment, and the caption names it.
  const first = await meet(page, mapId, 'huddlenut');
  const reveal = page.locator('.rare-reveal');
  await expect(reveal).toHaveClass(/rare-reveal-full/, { timeout: 60_000 });
  await advance(page, 1);
  await expect(reveal.locator('.rare-reveal-banner')).toHaveText('✨ Something rare is here! ✨');
  await expect(reveal.locator('.rare-reveal-sparkle')).not.toHaveCount(0);
  await expect(page.getByTestId('battle-caption')).toHaveText('A wild Huddlenut wants to play!');

  // A tap right on a move skips the moment and nothing else: no move goes out.
  const move = page.getByTestId('battle-move').first();
  const box = (await move.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(reveal).toHaveCount(0);
  expect(await battleState(page)).toMatchObject({ turn: 0, waiting: false });
  const onServer = await api<{ battle: { view: { turn: number } } }>(
    page,
    'GET',
    `/battles/${first}`,
  );
  expect(onServer.body.battle.view.turn).toBe(0);
  await forfeit(page, first);

  // The same kind again: only the banner, which goes by itself and holds nothing.
  const again = await meet(page, mapId, 'huddlenut');
  await expect(reveal).toBeVisible({ timeout: 60_000 });
  await expect(reveal).not.toHaveClass(/rare-reveal-full/);
  await expect(reveal.locator('.rare-reveal-dim')).toHaveCount(0);
  await advance(page, 1500);
  await expect(reveal).toHaveCount(0);
  await forfeit(page, again);

  // Reduce Motion: the moment without sparkles.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calm = await meet(page, mapId, 'dawndrop');
  await expect(reveal).toHaveClass(/rare-reveal-calm/, { timeout: 60_000 });
  await expect(reveal).toHaveClass(/rare-reveal-full/);
  await expect(reveal.locator('.rare-reveal-sparkle')).toHaveCount(0);
  await advance(page, 5000);
  await expect(reveal).toHaveCount(0);
  await forfeit(page, calm);

  // A common squishy gets nothing new.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await meet(page, mapId, 'puddlepuff');
  await expect(page.getByTestId('battle-caption')).toHaveText('A wild squishy wants to play!');
  await expect(reveal).toHaveCount(0);

  expect(errors).toEqual([]);
});
