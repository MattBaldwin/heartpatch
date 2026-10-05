import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { holdCinematic, newPlayer, pickKeeper, signUp, uniqueName } from './players.js';

// The opening cinematic (#46, design doc §25): it plays once after the
// Keeper pick and before the tutorial, a tap moves the captions on, a long
// press skips it even the first time, and Settings plays it again with a
// Skip button. Asserts on the dev hook, never on pixels.

/** `CinematicDebug` from src/cinematics/cinematic-screen.ts. */
interface CinematicDebug {
  mode: 'first' | 'replay' | null;
  t: number;
  shot: string | null;
  caption: string | null;
  skippable: boolean;
  reducedMotion: boolean;
  seen: { seenAt: string | null } | null;
  ended: 'watched' | 'skipped' | null;
  scene: { squishies: number; tiles: number; playerKeeper: boolean } | null;
}

/** The story's scene builds on the main thread; under CI's software GL a poll can wait a while. */
const SLOW = { timeout: 30_000 };

const story = (page: Page) => hook<CinematicDebug>(page, 'cinematic');

/**
 * WebKit's page error for an in-flight API fetch that a navigation aborts
 * (on CI it reads "…/localhost:5173/api/v1/maps/<id>/wild due to access
 * control checks.").
 */
const ABORTED_FETCH = /\/api\/v1\/\S* due to access control checks\.?$/;

const seenOnServer = async (page: Page) =>
  (await api<{ cinematic: { seenAt: string | null } }>(page, 'GET', '/cinematic')).body.cinematic
    .seenAt;

test('a new player sees the story after their Keeper, then the tutorial', async ({ page }) => {
  test.setTimeout(180_000); // builds the story's world; CI renders in software
  const errors: string[] = [];
  // WebKit reports a fetch the reload below aborts (the battle HUD's
  // `/maps/<id>/wild` hint, already caught by the app) as a page error. Only
  // that message, and only while reloading, is let through; every other error
  // stays fatal.
  let reloading = false;
  page.on('pageerror', (err) => {
    if (reloading && ABORTED_FETCH.test(err.message)) return;
    errors.push(err.message);
  });
  await signUp(page, uniqueName('story'));
  expect(await seenOnServer(page)).toBeNull();

  // Keeper first, then the story, with no lobby behind it.
  await pickKeeper(page, 'Wren', 'play');
  const cinematic = page.getByTestId('cinematic');
  await expect(cinematic).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('lobby')).toBeHidden();
  await expect.poll(async () => (await story(page))?.mode, SLOW).toBe('first');
  // The first time there's no Skip button; holding is how to skip.
  await expect(page.getByTestId('cinematic-skip')).toBeHidden();
  await expect(page.getByTestId('cinematic-hold')).toContainText('Hold to skip');
  // A tap moves the captions on (whichever one is up, the next one follows).
  const caption = page.getByTestId('cinematic-caption');
  await cinematic.tap();
  await expect.poll(async () => (await story(page))?.caption ?? null, SLOW).not.toBeNull();
  const first = (await story(page))!;
  await expect(caption).toHaveText(first.caption!);
  await cinematic.tap();
  await expect.poll(async () => (await story(page))?.caption, SLOW).not.toBe(first.caption);
  const second = (await story(page))!;
  expect(second.t).toBeGreaterThan(first.t);
  await expect(caption).toHaveText(second.caption!);
  // The caption sits inside the 16px gutters, and the account chip steps
  // aside while the story plays (#156).
  const box = (await caption.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(16 - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(width - 16 + 0.5);
  await expect(page.getByTestId('auth-user')).toBeHidden();

  // Drawn with the game's own squishies and world.
  await expect
    .poll(async () => (await story(page))?.scene?.squishies ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  expect((await story(page))?.scene?.tiles).toBeGreaterThan(100);
  expect((await story(page))?.reducedMotion).toBe(false);

  // A long press skips it, even the first time; the account remembers.
  await holdCinematic(page);
  await expect(cinematic).toBeHidden();
  expect((await story(page))?.ended).toBe('skipped');
  await expect(page.getByTestId('auth-user')).toBeVisible();
  await expect.poll(() => seenOnServer(page), SLOW).not.toBeNull();

  // Then the tutorial (optional on the dev server) and the lobby.
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({
    timeout: 15_000,
  });
  await lobby.getByTestId('tutorial-start').tap();
  await expect
    .poll(async () => (await hook<{ stepId: string | null }>(page, 'tutorial'))?.stepId ?? null, {
      timeout: 30_000,
    })
    .toBe('welcome');

  // A returning player goes straight on: here, back into the tutorial run.
  reloading = true;
  await page.reload();
  reloading = false;
  await expect(page.getByTestId('tutorial-bubble')).toBeVisible({ timeout: 30_000 });
  expect((await story(page))?.seen?.seenAt ?? null).not.toBeNull();
  await expect(cinematic).toBeHidden();
  expect((await story(page))?.mode).toBeNull();
  expect(errors).toEqual([]);
});

test('Settings plays it again, with a Skip button and gentler motion', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('again'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const lobby = page.getByTestId('lobby');
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('cinematic-settings').tap();

  const cinematic = page.getByTestId('cinematic');
  await expect(cinematic).toBeVisible({ timeout: 30_000 });
  await expect(lobby).toBeHidden();
  await expect.poll(async () => (await story(page))?.mode, SLOW).toBe('replay');
  const state = (await story(page))!;
  expect(state.skippable).toBe(true);
  expect(state.reducedMotion).toBe(true);

  await page.getByTestId('cinematic-skip').tap();
  await expect(cinematic).toBeHidden();
  expect((await story(page))?.ended).toBe('skipped');
  await expect(lobby).toBeVisible();
});
