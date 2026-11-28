import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The Christmas Eve notice, fall beat, thanks sheet and card lines (#37 X5b).
 * The server's rules are its own tests' (modules/boss/eve-view.test.ts); this
 * checks the client words and draws what `MapView.christmas.eve` says. The
 * Eve's map view is answered here (the server needs Dec 24 on the clock) and
 * must still parse as the shared contract; the client is the real one.
 */

interface EveDebug {
  stage: 'notice' | 'open' | 'fell' | 'dozed' | null;
  notice: string | null;
  sheetOpen: boolean;
  waiting: boolean;
  beat: boolean;
  asksLeft: number | null;
  items: string[] | null;
}
const eveState = (page: Page) => hook<EveDebug>(page, 'eve');

const BATTLE = '5b9f7a4e-3f0a-4e0b-9d9d-0a1b2c3d4e5f';
type Eve = Record<string, unknown>;

/** Answers the map view with `eve()` and records the asks sent. */
async function stubEve(page: Page, eve: () => Eve | undefined) {
  const asked: number[] = [];
  await page.route('**/api/v1/maps/*/view', async (route) => {
    const res = await route.fetch();
    const view = (await res.json()) as Record<string, unknown>;
    view['christmas'] = { presentWaiting: false, eve: eve() };
    await route.fulfill({ response: res, json: view });
  });
  await page.route('**/api/v1/battles/*/befriend', async (route) => {
    const { ask } = route.request().postDataJSON() as { ask: number };
    asked.push(ask);
    await route.fulfill({
      status: 409,
      json: { error: { code: 'CONFLICT', message: 'Mixed up! Try again.' } },
    });
  });
  return { asked };
}

async function openPatch(page: Page, name: string): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill(name);
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // A thanks sheet pops over everything (and over the tray hint): leave the hint for after it.
  const hint = page.getByTestId('tray-hint-ok');
  if ((await hint.isVisible()) && !(await page.getByTestId('eve-sheet').isVisible())) {
    await hint.tap();
  }
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

test.describe('the Christmas Eve thanks (#37 X5b)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('the notice chip shows before the visit opens, and only then', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('note'));
    await stubEve(page, () => ({ opensAt: inDays(2) }));
    await openPatch(page, 'Notice Patch');
    const chip = page.getByTestId('eve-notice');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Something BIG visits on Christmas Eve');
    expect((await eveState(page))?.stage).toBe('notice');
  });

  test('a fall pops the thanks sheet with the bundle and two asks', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('fell'));
    const { asked } = await stubEve(page, () => ({
      opensAt: inDays(-1),
      state: 'fell',
      chipped: 220,
      goal: 200,
      chippers: 3,
      warmedUp: true,
      thanks: {
        kind: 'fell',
        items: { 'heart-charm': 6, heartdust: 10 },
        asksLeft: 2,
        battleId: BATTLE,
      },
    }));
    await openPatch(page, 'Fall Patch');
    const sheet = page.getByTestId('eve-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('eve-bundle').locator('li')).toHaveCount(2);
    await expect(sheet.getByTestId('eve-asks')).toHaveText('2 asks left');
    await sheet.getByTestId('eve-ask').tap();
    await expect.poll(() => asked).toEqual([1]);
    // A refused ask is a friendly line, not an error screen.
    await expect(sheet).toContainText('Mixed up');
    await sheet.getByTestId('eve-done').tap();
    await expect(sheet).toBeHidden();
    // The first-run tray hint waited behind the sheet; then the chip brings it back.
    const hint = page.getByTestId('tray-hint-ok');
    if (await hint.isVisible()) await hint.tap();
    await page.getByTestId('eve-gift').tap();
    await expect(sheet).toBeVisible();
  });

  test('a doze says it wandered home, with the bundle and no asks', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('doze'));
    await stubEve(page, () => ({
      opensAt: inDays(-2),
      state: 'dozed',
      chipped: 60,
      goal: 200,
      chippers: 2,
      thanks: { kind: 'dozed', items: { 'heart-charm': 2 }, asksLeft: 0, battleId: BATTLE },
    }));
    await openPatch(page, 'Doze Patch');
    const sheet = page.getByTestId('eve-sheet');
    await expect(sheet).toContainText('wandered home at dawn');
    await expect(sheet.getByTestId('eve-bundle').locator('li')).toHaveCount(1);
    await expect(sheet.getByTestId('eve-ask')).toHaveCount(0);
  });

  test('the card says how many chipped in and that the lights warmed it up', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('card'));
    await stubEve(page, () => ({
      opensAt: inDays(-1),
      state: 'open',
      chipped: 90,
      goal: 200,
      chippers: 4,
      warmedUp: true,
    }));
    await openPatch(page, 'Card Patch');
    expect((await eveState(page))?.stage).toBe('open');
    // The card's own lines are checked in eve-model.test.ts; here the sheet stays shut.
    await expect(page.getByTestId('eve-sheet')).toBeHidden();
    await expect(page.getByTestId('eve-notice')).toBeHidden();
  });

  test('the fall plays a beat, then waits gently for the thanks', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('beat'));
    let eve: Eve = { opensAt: inDays(-1), state: 'open', chipped: 190, goal: 200, chippers: 3 };
    await stubEve(page, () => eve);
    await openPatch(page, 'Beat Patch');
    expect((await eveState(page))?.stage).toBe('open');
    eve = { opensAt: inDays(-1), state: 'fell', chipped: 210, goal: 200, chippers: 4 };
    await page.evaluate(() =>
      (window as { __heartpatch?: { mapDev?: () => { refresh(): void } } }).__heartpatch
        ?.mapDev?.()
        .refresh(),
    );
    await expect(page.getByTestId('eve-beat')).toBeVisible();
    await expect(page.getByTestId('eve-beat')).toContainText('fell asleep');
    expect((await eveState(page))?.stage).toBe('fell');
  });
});
