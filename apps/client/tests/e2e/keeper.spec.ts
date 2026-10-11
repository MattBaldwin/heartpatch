import { expect, test, type Page } from '@playwright/test';
import { draws, hook, idle } from './dev-hook.js';
import { expectRoomyLabels, settled } from './layout.js';
import { savedCode, skipCinematic, TEST_PASSWORD, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * Picking a Keeper (issue #42; step by step since #372): a new account builds
 * one before it can reach a patch, changes it for free from Settings, and shows it on the map and in
 * battles. Checked through the dev hook's signals, never pixels.
 */

interface KeeperConfig {
  base: string;
  face?: string;
  body?: string;
  hairColor: string;
  eyeColor: string;
  outfit: string;
  hairstyle?: string;
}

/** `KeeperDebug` from src/ui/keeper/keeper-screen.ts (this project can't see its types). */
interface KeeperDebug {
  mode: 'first' | 'edit' | null;
  picked: KeeperConfig | null;
  step: string | null;
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

test('a new Keeper is built step by step before any patch, remembered, and changed for free', async ({
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
  expect(start).toMatchObject({ mode: 'first', saved: null, step: 'face' });
  const next = picker.getByRole('button', { name: 'Next', exact: true });
  const tap = (name: string) => picker.getByRole('button', { name, exact: true }).tap();

  // One step a screen (#372): face, body, skin, hair style, hair and outfit
  // colours, face details. Every pick shows on the 3D Keeper.
  await expect(picker.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await tap('Face: Button');
  await next.tap();
  await tap('Body: Lanky');
  await next.tap();
  await tap('Skin tone 2');
  await next.tap();
  await tap('Hair style: Pigtails');
  await next.tap();
  await tap('Hair: Mint');
  await tap('Outfit: Pumpkin');
  await next.tap();
  expect((await keeperState(page))!.step).toBe('details');
  await expect(next).toBeHidden();
  await tap('Eyes: Happy');
  await tap('Eye color: Violet');
  await tap('Brows: Soft');
  await tap('Mouth: Big smile');
  await tap('Extras: Freckles');
  await tap('Extras: Blush');
  const picked = (await keeperState(page))!;
  // Face and body are their own choices; the starting look stays Pip.
  expect(picked.picked).toEqual({
    base: 'pip',
    face: 'wren',
    body: 'lanky',
    hairstyle: 'pigtails',
    hairColor: 'mint',
    eyeColor: 'violet',
    outfit: 'pumpkin',
    skinTone: 'tone-2',
    eyes: 'happy',
    brows: 'soft',
    mouth: 'big-smile',
    extras: ['blush', 'freckles'],
  });
  await expect(picker.getByRole('button', { name: 'Extras: Freckles' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(picked.preview).not.toBe(start.preview);

  // Back keeps every pick.
  await tap('Back');
  await expect(picker.getByRole('button', { name: 'Hair: Mint' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await next.tap();
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

  // Settings → Change Keeper → the Body tab → a new body, for free.
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('keeper-settings').tap();
  await expect(picker.getByRole('heading', { name: 'Your Keeper' })).toBeVisible();
  expect((await keeperState(page))!).toMatchObject({ mode: 'edit', picked: picked.picked });
  await picker.getByRole('tab', { name: 'Body' }).tap();
  await tap('Body: Sturdy');
  await picker.getByRole('button', { name: 'Save' }).tap();
  await expect(lobby.getByTestId('lobby-notice')).toHaveText('Looking good, Keeper!');
  expect((await keeperState(page))!.saved).toMatchObject({ face: 'wren', body: 'sturdy' });

  // Back leaves it as it was.
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('keeper-settings').tap();
  await tap('Face: Moon');
  await picker.getByRole('button', { name: 'Back' }).tap();
  await waitForLobby(page);
  expect((await keeperState(page))!.saved).toMatchObject({ face: 'wren', body: 'sturdy' });
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

  // A new Keeper starts on Pip's own style…
  await picker.getByRole('tab', { name: 'Hair' }).tap();
  await expect(style('Spiky')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => keeperState(page).then((s) => s?.preview ?? null)).not.toBeNull();
  const pip = (await keeperState(page))!;
  expect(pip.picked).not.toHaveProperty('hairstyle');

  // …and can wear any other; everything else stays.
  await style('Long').tap();
  await expect(style('Long')).toHaveAttribute('aria-pressed', 'true');
  await expect(style('Spiky')).toHaveAttribute('aria-pressed', 'false');
  const styled = (await keeperState(page))!;
  expect(styled.picked).toEqual({ ...pip.picked, hairstyle: 'long' });
  expect(styled.preview).not.toBe(pip.preview);

  await picker.getByRole('tab', { name: 'Details' }).tap();
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
  await picker.getByRole('tab', { name: 'Hair' }).tap();
  await expect(style('Long')).toHaveAttribute('aria-pressed', 'true');

  // Picking Pip's own style again stores none.
  await style('Spiky').tap();
  expect((await keeperState(page))!.picked).toEqual(pip.picked);
  await picker.getByRole('button', { name: 'Back' }).tap();
  await waitForLobby(page);
  expect(errors).toEqual([]);
});

test('the Keeper stands at home on the map and cheers in battles', async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, uniqueName('cheer'));
  const picker = page.getByTestId('keeper-picker');
  await picker.getByRole('button', { name: 'Face: Peach', exact: true }).tap();
  await picker.getByRole('tab', { name: 'Details' }).tap();
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

test('every step of the creator fits phones, iPads and laptops with no scroll inside scroll (#130, #372)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signUp(page, uniqueName('rows'));
  const picker = page.getByTestId('keeper-picker');
  await expect(picker.getByRole('heading', { name: 'Pick your Keeper!' })).toBeVisible();
  const steps = ['Face', 'Body', 'Skin', 'Hair', 'Color', 'Details'];

  // An iPhone SE, an iPhone in a Safari tab and as an app, an iPad, two laptops.
  for (const size of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 393, height: 659 },
    { width: 390, height: 844 },
    { width: 1180, height: 820 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    for (const tab of steps) {
      await picker.getByRole('tab', { name: tab }).tap();
      await settled(page);
      const layout = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.keeper-card')!;
        const tabs = document.querySelector<HTMLElement>('.keeper-tabs')!;
        const rows = document.querySelector<HTMLElement>('.keeper-rows')!;
        const actions = document.querySelector<HTMLElement>('.keeper-actions')!;
        const onScreen = (node: HTMLElement) => {
          const box = node.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= window.innerHeight;
        };
        // The step's own list is the only thing that may scroll, and only up and down.
        const scrollers = [...card.querySelectorAll<HTMLElement>('*')].filter((node) => {
          const style = getComputedStyle(node);
          const can = (o: string) => o === 'auto' || o === 'scroll';
          return (
            node !== rows &&
            ((can(style.overflowY) && node.scrollHeight > node.clientHeight) ||
              (can(style.overflowX) && node.scrollWidth > node.clientWidth))
          );
        });
        return {
          tabsFit: tabs.scrollWidth <= tabs.clientWidth,
          rowsSideways: rows.scrollWidth > rows.clientWidth,
          nested: scrollers.map((n) => n.className),
          actionsShow: onScreen(actions),
          scrolls: rows.scrollHeight > rows.clientHeight + 1,
          // Scrolled to, every choice is what a finger on it touches.
          reachable: [...rows.querySelectorAll<HTMLElement>('button')].every((button) => {
            button.scrollIntoView({ block: 'nearest' });
            const box = button.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return hit?.closest('button') === button && onScreen(actions);
          }),
        };
      });
      const at = `${tab} at ${String(size.width)}×${String(size.height)}`;
      expect(layout, at).toMatchObject({
        tabsFit: true,
        rowsSideways: false,
        nested: [],
        actionsShow: true,
        reachable: true,
      });
      // Faces, bodies, skin and hair colour all show at once from an iPhone
      // SE's height up (iOS 17 phones); shorter screens scroll the one list.
      if (size.height >= 659 && !['Hair', 'Details'].includes(tab)) {
        expect(layout.scrolls, at).toBe(false);
      }
    }
    await expectRoomyLabels(page, '.keeper-tab, .keeper-style, .keeper-actions .auth-button');
  }

  // Tapping an outfit picks it; it never saves the Keeper by mistake.
  await picker.getByRole('tab', { name: 'Color' }).tap();
  await picker.getByRole('button', { name: 'Outfit: Pumpkin' }).tap();
  await expect(picker).toBeVisible();
  expect((await keeperState(page))!).toMatchObject({
    mode: 'first',
    saved: null,
    picked: { outfit: 'pumpkin' },
  });
});
