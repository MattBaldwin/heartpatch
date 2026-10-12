import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { careFromRoster, closeRoster, openRoster } from './roster.js';
import { closeTrays, trayButton } from './trays.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

interface RosterDebug {
  open: boolean;
  rows: number;
  shown: string[];
  sort: string;
  filter: string;
  expanded: string | null;
}

const rosterState = (page: Page) => hook<RosterDebug>(page, 'roster');

/** No box is under 44pt (style guide §3.2). */
async function expectTapSize(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((n) => (n as HTMLElement).offsetParent !== null)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
}

/**
 * The Squishies roster (#375): 🐾 in the top bar opens one list of my
 * squishies with the real squishy, hearts and mood, stage and job; Care is
 * two taps away and the list reads again after; sort, filter and an open row
 * work; and it's one scroll area with 44pt targets. Checked through the dev
 * hook and the DOM, not pixels.
 */
test('the Squishies roster: one tap from the top bar, care in two', async ({ browser }) => {
  test.setTimeout(240_000); // a patch, two scene builds and the portraits; CI renders in software
  const page = await newPlayer(browser, uniqueName('roster'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Roster Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  // A second squishy, so sort and filter have something to order.
  await (await trayButton(page, 'battle-dev-grant')).tap();
  await slowExpect(page.locator('.battle-entry-note')).toContainText('joined you');
  await closeTrays(page);

  // The map: 🐾 sits with the round buttons at the top; one tap opens the list.
  const mapButton = page.locator('[data-testid="squishies-open"][data-where="map"]');
  await slowExpect(mapButton).toBeVisible();
  await expectTapSize(page, '[data-testid="squishies-open"]');
  const roster = await openRoster(page);
  await expect.poll(async () => (await rosterState(page))?.rows, slow).toBe(2);
  // Focus starts at the roster's title, for VoiceOver (#433).
  await expect(page.locator('#roster-title')).toBeFocused();
  const rows = page.getByTestId('roster-row');
  // Each row: the real squishy (drawn on the game's engine), hearts and mood, stage, status.
  await slowExpect(page.locator('[data-testid="roster-portrait"][data-ready="true"]')).toHaveCount(
    2,
  );
  for (const row of await rows.all()) {
    await expect(row.getByTestId('roster-mood')).toHaveAttribute('data-hearts', /^\d(\.5)?$/);
    await expect(row.getByTestId('roster-status')).toBeVisible();
  }
  await expect(roster.getByTestId('roster-stage').first()).toContainText(/Stage \d of \d/);
  // Needs care shows exactly on the rows below Happy.
  for (const row of await rows.all()) {
    const mood = await row.getByTestId('roster-mood').getAttribute('data-mood');
    const badge = row.getByTestId('roster-needs-care');
    if (mood === 'calm' || mood === 'cuddly') await expect(badge).toBeVisible();
    else await expect(badge).toHaveCount(0);
  }
  // One scroll area: nothing inside the sheet scrolls by itself.
  const nested = await roster.evaluate(
    (sheet) =>
      [...sheet.querySelectorAll('*')].filter((n) => {
        const s = getComputedStyle(n);
        return /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
      }).length,
  );
  expect(nested).toBe(0);
  await expectTapSize(page, '[data-testid="roster-care"], [data-testid^="roster-pick-"]');

  // Sort and Show: one compact row of two pickers; a choice closes its menu.
  await page.getByTestId('roster-pick-sort').tap();
  await page.locator('[data-sort="level"]').tap();
  await expect.poll(async () => (await rosterState(page))?.sort).toBe('level');
  await page.getByTestId('roster-pick-filter').tap();
  await page.locator('[data-filter="team"]').tap();
  await expect.poll(async () => (await rosterState(page))?.filter).toBe('team');
  const onTeam = (await rosterState(page))?.shown.length ?? 0;
  await expect(page.getByTestId('roster-count')).toHaveText(`${String(onTeam)} of 2`);
  await page.getByTestId('roster-pick-filter').tap();
  await page.locator('[data-filter="all"]').tap();

  // A row opens: its jobs (the job board's own buttons) and Up close / Dress up.
  await rows.first().getByTestId('roster-head').tap();
  const detail = page.getByTestId('roster-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('[data-job="team"]')).toBeVisible();
  await expect(detail.getByTestId('roster-up-close')).toBeVisible();
  expect((await rosterState(page))?.expanded).not.toBeNull();

  // Care in two taps (🐾, then Care); the roster reads again once the sheet closes.
  await closeRoster(page);
  const care = await careFromRoster(page);
  await care.locator('[data-care="pet"]').tap();
  await slowExpect(page.getByTestId('care-note')).not.toBeEmpty();
  await care.getByRole('button', { name: 'All done' }).tap();
  await expect(care).toBeHidden();
  await expect(roster).toBeVisible();
  await closeRoster(page);

  // Home: 🐾 top-left opens the same list.
  await (await trayButton(page, 'home-open')).tap();
  await slowExpect(page.locator('[data-testid="squishies-open"][data-where="home"]')).toBeVisible();
  await openRoster(page);
  await expect.poll(async () => (await rosterState(page))?.rows, slow).toBe(2);
  await closeRoster(page);
  // By keyboard, × hands focus back to the 🐾 that opened it (#433).
  const homeButton = page.locator('[data-testid="squishies-open"][data-where="home"]');
  await homeButton.focus();
  await page.keyboard.press('Enter');
  await expect(roster).toBeVisible();
  await expect(page.locator('#roster-title')).toBeFocused(slow);
  await roster.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(roster).toBeHidden();
  await expect(homeButton).toBeFocused();

  expect(errors).toEqual([]);
  await page.context().close();
});
