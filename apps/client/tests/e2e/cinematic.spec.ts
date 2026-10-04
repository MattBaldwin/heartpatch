import { expect, test, type Page } from '@playwright/test';
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

interface Hook {
  cinematic?(): CinematicDebug | null;
  tutorial?(): { stepId: string | null } | null;
}

/** The story's scene builds on the main thread; under CI's software GL a poll can wait a while. */
const SLOW = { timeout: 30_000 };

const story = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __heartpatch?: Hook }).__heartpatch?.cinematic?.() ?? null,
  );

const seenOnServer = (page: Page) =>
  page.evaluate(async () => {
    const res = await fetch('/api/v1/cinematic', { headers: { 'x-requested-with': 'heartpatch' } });
    return ((await res.json()) as { cinematic: { seenAt: string | null } }).cinematic.seenAt;
  });

test('a new player sees the story after their Keeper, then the tutorial', async ({ page }) => {
  test.setTimeout(180_000); // builds the story's world; CI renders in software
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
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

  // Drawn with the game's own squishies and world.
  await expect
    .poll(async () => (await story(page))?.scene?.squishies ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
  expect((await story(page))?.scene?.tiles).toBeGreaterThan(100);
  expect((await story(page))?.reducedMotion).toBe(false);

  // A long press skips it, even the first time; the account remembers.
  await holdCinematic(page, 1600);
  await expect(cinematic).toBeHidden();
  expect((await story(page))?.ended).toBe('skipped');
  await expect.poll(() => seenOnServer(page), SLOW).not.toBeNull();

  // Then the tutorial (optional on the dev server) and the lobby.
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({
    timeout: 15_000,
  });
  await lobby.getByTestId('tutorial-start').tap();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __heartpatch?: Hook }).__heartpatch?.tutorial?.()?.stepId ??
            null,
        ),
      { timeout: 30_000 },
    )
    .toBe('welcome');

  // A returning player goes straight on: here, back into the tutorial run.
  await page.reload();
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
