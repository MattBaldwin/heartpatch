import { expect, test, type Page } from '@playwright/test';
import { draws, hook, idle } from './dev-hook.js';
import { expectRoomyLabels, settled } from './layout.js';
import { savedCode, skipCinematic, TEST_PASSWORD, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * Picking a Keeper (issue #42): a new account picks one before it can reach
 * a patch, changes it for free from Settings, and shows it on the map and in
 * battles. Checked through the dev hook's signals, never pixels.
 */

interface KeeperConfig {
  base: string;
  hairColor: string;
  eyeColor: string;
  outfit: string;
  hairstyle?: string;
}

/** `KeeperDebug` from src/ui/keeper/keeper-screen.ts (this project can't see its types). */
interface KeeperDebug {
  mode: 'first' | 'edit' | null;
  picked: KeeperConfig | null;
  saved: KeeperConfig | null;
  preview: string | null;
  hopping: boolean;
}

const keeperState = (page: Page) => hook<KeeperDebug>(page, 'keeper');

/** Waits until nothing is drawn for `quietMs` and the loop reports idle (see smoke.spec.ts). */
async function waitForIdle(page: Page, quietMs = 500): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await draws(page);
        await page.waitForTimeout(quietMs);
        const isIdle = await idle(page);
        return isIdle && (await draws(page)) === before;
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true);
}

/**
 * Waits for the lobby. After a save it opens only once the server has kept
 * the Keeper (the picker closes, `saved` set) and the lobby has fetched my
 * patches, two round trips that can be slow while other projects build maps.
 */
async function waitForLobby(page: Page): Promise<void> {
  await expect
    .poll(() => keeperState(page).then((s) => s !== null && s.mode === null && s.saved !== null), {
      timeout: 30_000,
    })
    .toBe(true);
  await expect(
    page.getByTestId('lobby').getByRole('heading', { name: 'Your patches' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function signUp(page: Page, name: string): Promise<void> {
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family or invite code').fill(process.env['HP_SIGNUP_CODE'] ?? '');
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill(TEST_PASSWORD);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await savedCode(overlay);
  // Straight on to the lobby after the pick: the story has its own spec.
  await skipCinematic(page);
}

test('a new Keeper is picked before any patch, remembered, and changed for free', async ({
  page,
}) => {
  test.setTimeout(240_000); // several scene builds; CI renders in software
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await signUp(page, uniqueName('keep'));

  // Straight after signup: the picker, and no lobby (or tutorial) behind it yet.
  const picker = page.getByTestId('keeper-picker');
  await expect(picker.getByRole('heading', { name: 'Pick your Keeper!' })).toBeVisible();
  await expect(page.getByTestId('lobby')).toBeHidden();
  await expect.poll(() => keeperState(page).then((s) => s?.preview ?? null)).not.toBeNull();
  const start = (await keeperState(page))!;
  expect(start).toMatchObject({ mode: 'first', saved: null });

  // Every pick shows on the 3D Keeper, which hops, then stops drawing.
  await picker.getByRole('button', { name: 'Wren', exact: true }).tap();
  await picker.getByRole('button', { name: 'Hair: Mint' }).tap();
  await picker.getByRole('button', { name: 'Eyes: Violet' }).tap();
  await picker.getByRole('button', { name: 'Outfit: Pumpkin' }).tap();
  const picked = (await keeperState(page))!;
  expect(picked.picked).toEqual({
    base: 'wren',
    hairColor: 'mint',
    eyeColor: 'violet',
    outfit: 'pumpkin',
  });
  expect(picked.preview).not.toBe(start.preview);
  await expect(picker.getByRole('button', { name: 'Hair: Mint' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await waitForIdle(page);

  // "That's me!" saves it and opens the lobby.
  await picker.getByRole('button', { name: 'That’s me!' }).tap();
  const lobby = page.getByTestId('lobby');
  await waitForLobby(page);
  await expect(picker).toBeHidden();
  expect((await keeperState(page))!.saved).toEqual(picked.picked);

  // Remembered: a reload goes straight to the lobby.
  await page.reload();
  await waitForLobby(page);
  await expect(picker).toBeHidden();
  await expect.poll(() => keeperState(page).then((s) => s?.saved ?? null)).toEqual(picked.picked);

  // Settings → Change Keeper → a new look, for free.
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('keeper-settings').tap();
  await expect(picker.getByRole('heading', { name: 'Your Keeper' })).toBeVisible();
  expect((await keeperState(page))!).toMatchObject({ mode: 'edit', picked: picked.picked });
  await picker.getByRole('button', { name: 'Bramble', exact: true }).tap();
  await picker.getByRole('button', { name: 'Save' }).tap();
  await expect(lobby.getByTestId('lobby-notice')).toHaveText('Looking good, Keeper!');
  expect((await keeperState(page))!.saved).toMatchObject({ base: 'bramble' });

  // Back leaves it as it was.
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('keeper-settings').tap();
  await picker.getByRole('button', { name: 'Pip', exact: true }).tap();
  await picker.getByRole('button', { name: 'Back' }).tap();
  await waitForLobby(page);
  expect((await keeperState(page))!.saved).toMatchObject({ base: 'bramble' });
  expect(errors).toEqual([]);
});

test('any Keeper wears any hair style, kept after a reload', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await signUp(page, uniqueName('hair'));
  const picker = page.getByTestId('keeper-picker');
  await expect(picker.getByRole('heading', { name: 'Pick your Keeper!' })).toBeVisible();
  const style = (name: string) => picker.getByRole('button', { name: `Hair style: ${name}` });

  // A new Keeper comes with its own short style…
  await picker.getByRole('button', { name: 'Rowan', exact: true }).tap();
  await expect(style('Crew Cut')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => keeperState(page).then((s) => s?.preview ?? null)).not.toBeNull();
  const rowan = (await keeperState(page))!;
  expect(rowan.picked).toEqual({
    base: 'rowan',
    hairColor: 'midnight',
    eyeColor: 'hazel',
    outfit: 'sunflower',
  });

  // …and can wear any other; the Keeper and colours stay.
  await style('Long').tap();
  await expect(style('Long')).toHaveAttribute('aria-pressed', 'true');
  await expect(style('Crew Cut')).toHaveAttribute('aria-pressed', 'false');
  const styled = (await keeperState(page))!;
  expect(styled.picked).toEqual({ ...rowan.picked, hairstyle: 'long' });
  expect(styled.preview).not.toBe(rowan.preview);

  await picker.getByRole('button', { name: 'That’s me!' }).tap();
  await waitForLobby(page);
  expect((await keeperState(page))!.saved).toEqual(styled.picked);

  // Kept: after a reload the editor opens on the same style.
  await page.reload();
  await waitForLobby(page);
  await expect.poll(() => keeperState(page).then((s) => s?.saved ?? null)).toEqual(styled.picked);
  const lobby = page.getByTestId('lobby');
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('keeper-settings').tap();
  await expect(style('Long')).toHaveAttribute('aria-pressed', 'true');

  // Picking a Keeper again goes back to its own style.
  await picker.getByRole('button', { name: 'Rowan', exact: true }).tap();
  await expect(style('Crew Cut')).toHaveAttribute('aria-pressed', 'true');
  expect((await keeperState(page))!.picked).toEqual(rowan.picked);
  await picker.getByRole('button', { name: 'Back' }).tap();
  await waitForLobby(page);
  expect(errors).toEqual([]);
});

test('the Keeper stands at home on the map and cheers in battles', async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, uniqueName('cheer'));
  const picker = page.getByTestId('keeper-picker');
  await picker.getByRole('button', { name: 'Sunny', exact: true }).tap();
  await picker.getByRole('button', { name: 'That’s me!' }).tap();

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Keeper Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.getByTestId('map-hud')).toContainText('Keeper Patch');
  // Drawn with the map, which can take a while when CI renders in software.
  await expect
    .poll(async () => (await hook<{ keepers: number }>(page, 'map'))?.keepers, {
      timeout: 60_000,
    })
    .toBe(1);

  // A dev battle (spawns arrive with #14): the Keeper is in the arena…
  await (await trayButton(page, 'battle-dev-grant')).tap();
  await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  await (await trayButton(page, 'battle-dev-fight')).tap();
  await expect(page.getByTestId('battle-hud')).toBeVisible();
  const battle = () =>
    hook<{
      scene: { keeper: boolean } | null;
      keeperReactions: number;
      pending: number;
    }>(page, 'battle');
  // The arena builds first, which is slow when CI renders in software.
  await expect.poll(() => battle().then((b) => b?.scene?.keeper), { timeout: 30_000 }).toBe(true);
  expect((await battle())?.keeperReactions).toBe(0);

  // …and reacts as the turn plays out (a run-away still ends the battle with a reaction).
  await page.getByRole('button', { name: 'Run away' }).tap();
  await page.getByTestId('battle-run-confirm').tap();
  // The log plays out first, which is slow when CI renders in software.
  await expect
    .poll(() => battle().then((b) => b?.keeperReactions ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(0);
});

test('every row of the picker is reachable on phones, iPads and laptops (#130)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page, uniqueName('rows'));
  const picker = page.getByTestId('keeper-picker');
  await expect(picker.getByRole('heading', { name: 'Pick your Keeper!' })).toBeVisible();

  // An iPhone in a Safari tab and as an app, an iPad, two laptops.
  for (const size of [
    { width: 393, height: 659 },
    { width: 390, height: 844 },
    { width: 1180, height: 820 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await settled(page);
    const layout = await page.evaluate(() => {
      const rows = document.querySelector<HTMLElement>('.keeper-rows')!;
      return {
        // All five rows fit: nothing hides below "That's me!".
        fits: rows.scrollHeight <= rows.clientHeight + 1,
        // The first choice of each row is what a finger on it touches.
        reachable: [...rows.querySelectorAll('.keeper-row')].map((row) => {
          const button = row.querySelector('button')!;
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit?.closest('button') === button;
        }),
        // A swipe up or down that starts on a choice can still scroll the rows.
        swipe: getComputedStyle(rows.querySelector('.keeper-choices')!).touchAction,
      };
    });
    expect(layout, `${String(size.width)}×${String(size.height)}`).toEqual({
      fits: true,
      reachable: [true, true, true, true, true],
      swipe: 'pan-x pan-y',
    });
    // More Keepers than fit: the row says so (it fades out at the end).
    await expect(picker.locator('.keeper-choices').first()).toHaveAttribute('data-more', 'end');
  }

  // Tapping an outfit picks it; it never saves the Keeper by mistake.
  await picker.getByRole('button', { name: 'Outfit: Pumpkin' }).tap();
  await expect(picker).toBeVisible();
  expect((await keeperState(page))!).toMatchObject({
    mode: 'first',
    saved: null,
    picked: { outfit: 'pumpkin' },
  });
  await expectRoomyLabels(page, '.keeper-base, .keeper-style, .keeper-actions .auth-button');
});
