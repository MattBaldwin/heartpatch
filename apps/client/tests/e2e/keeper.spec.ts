import { expect, test, type Page } from '@playwright/test';
import { uniqueName } from './players.js';

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
}

/** `KeeperDebug` from src/ui/keeper/keeper-screen.ts (this project can't see its types). */
interface KeeperDebug {
  mode: 'first' | 'edit' | null;
  picked: KeeperConfig | null;
  saved: KeeperConfig | null;
  preview: string | null;
  hopping: boolean;
}

type Hook = {
  __heartpatch?: {
    keeper?(): KeeperDebug | null;
    map?(): { keepers: number } | null;
    battle?(): {
      scene: { keeper: boolean } | null;
      keeperReactions: number;
      pending: number;
    } | null;
    draws(): number;
    idle(): boolean;
  };
};

const keeperState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.keeper?.() ?? null);

const draws = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.draws() ?? 0);

/** Waits until nothing is drawn for `quietMs` and the loop reports idle (see smoke.spec.ts). */
async function waitForIdle(page: Page, quietMs = 500): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await draws(page);
        await page.waitForTimeout(quietMs);
        const idle = await page.evaluate(
          () => (window as unknown as Hook).__heartpatch?.idle() ?? false,
        );
        return idle && (await draws(page)) === before;
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true);
}

async function signUp(page: Page, name: string): Promise<void> {
  await page.goto('/');
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family code').fill(process.env['HP_SIGNUP_CODE'] ?? '');
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill('squishy-secret');
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByRole('button', { name: 'I saved it!' }).tap();
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
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  await expect(picker).toBeHidden();
  expect((await keeperState(page))!.saved).toEqual(picked.picked);

  // Remembered: a reload goes straight to the lobby.
  await page.reload();
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
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
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible();
  expect((await keeperState(page))!.saved).toMatchObject({ base: 'bramble' });
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
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(page.getByTestId('map-hud')).toContainText('Keeper Patch');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.()?.keepers))
    .toBe(1);

  // A dev battle (spawns arrive with #14): the Keeper is in the arena…
  await page.getByTestId('battle-entry').tap();
  await page.getByTestId('battle-dev-grant').tap();
  await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  await page.getByTestId('battle-dev-fight').tap();
  await expect(page.getByTestId('battle-hud')).toBeVisible();
  const battle = () => page.evaluate(() => (window as unknown as Hook).__heartpatch?.battle?.());
  await expect.poll(() => battle().then((b) => b?.scene?.keeper)).toBe(true);
  expect((await battle())?.keeperReactions).toBe(0);

  // …and reacts as the turn plays out (a run-away still ends the battle with a reaction).
  await page.getByRole('button', { name: 'Run away' }).tap();
  await page.getByTestId('battle-run-confirm').tap();
  await expect.poll(() => battle().then((b) => b?.keeperReactions ?? 0)).toBeGreaterThan(0);
});
