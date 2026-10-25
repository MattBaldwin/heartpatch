import { expect, test, type Locator, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { settled, still } from './layout.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { closeRoster, openRoster } from './roster.js';
import { closeTrays, openTray, trayButton } from './trays.js';

// A phone on its side (controls D): the screens that used to leave no room
// (the wardrobe showed zero rows of clothes) show their controls and rows,
// and every control is on screen and the thing a tap would hit. Measured as
// boxes and hit tests, never pixels.

const LANDSCAPE_PHONES = [
  { name: 'iPhone landscape', width: 844, height: 390 },
  { name: 'iPhone SE landscape', width: 667, height: 375 },
] as const;

/** The control sits fully on screen and is what a tap at its middle lands on. */
async function expectReachable(control: Locator, what: string): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const problems = await control.evaluate((el) => {
    const out: string[] = [];
    const b = el.getBoundingClientRect();
    if (
      b.left < -0.5 ||
      b.top < -0.5 ||
      b.right > innerWidth + 0.5 ||
      b.bottom > innerHeight + 0.5
    ) {
      out.push(`off screen ${JSON.stringify([b.left, b.top, b.right, b.bottom].map(Math.round))}`);
    }
    if (b.height < 43.5) out.push(`under 44 px (${String(Math.round(b.height))})`);
    const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    if (!hit || !(el === hit || el.contains(hit))) out.push('something else is on top');
    return out;
  });
  expect(problems, what).toEqual([]);
}

async function boxOf(
  page: Page,
  selector: string,
): Promise<{ l: number; t: number; r: number; b: number }> {
  await still(page, selector);
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    });
}

test('the wardrobe and the catalog fit a phone on its side', async ({ browser }) => {
  test.setTimeout(240_000); // a map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('side'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Side Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();

  for (const size of LANDSCAPE_PHONES) {
    await test.step(`wardrobe, ${size.name}`, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.getByTestId('keeper-menu').tap();
      await page.getByRole('button', { name: /Wardrobe/ }).tap();
      const wardrobe = page.getByTestId('wardrobe');
      await expect(wardrobe).toBeVisible();
      await expect
        .poll(
          async () => (await hook<{ preview: string | null }>(page, 'wardrobe'))?.preview ?? null,
        )
        .not.toBeNull();
      await settled(page);
      // Rows of clothes: the list has room for at least one whole row.
      const items = await boxOf(page, '[data-testid="wardrobe-items"]');
      expect(items.b - items.t, 'room for clothes').toBeGreaterThanOrEqual(64);
      await expectReachable(
        wardrobe.locator('[data-testid="wardrobe-items"] button').first(),
        'first piece',
      );
      await expectReachable(page.getByTestId('wardrobe-done'), 'Done');
      await expectReachable(page.getByTestId('wardrobe-boutique'), 'Boutique');
      await expectReachable(page.getByTestId('wardrobe-turn'), 'Turn around');
      // The card leaves the right of the screen for the Keeper and the "Log out" chip.
      const card = await boxOf(page, '.wardrobe-card');
      expect(card.r, 'card leaves the right of the screen').toBeLessThan(size.width * 0.7);
      // The Boutique and Milestones cards take the same panel: their way back
      // is reachable and their lists keep some room.
      await page.getByTestId('wardrobe-boutique').tap();
      await expectReachable(page.getByTestId('boutique-back'), 'Boutique Back');
      const racks = await boxOf(page, '[data-testid="boutique-racks"]');
      expect(racks.b - racks.t, 'room for racks').toBeGreaterThanOrEqual(88);
      await page.getByTestId('boutique-back').tap();
      await page.getByTestId('wardrobe-milestones').tap();
      await expectReachable(page.getByTestId('milestones-back'), 'Milestones Back');
      const list = await boxOf(page, '[data-testid="milestones-list"]');
      expect(list.b - list.t, 'room for milestones').toBeGreaterThanOrEqual(88);
      await page.getByTestId('milestones-back').tap();
      // Turning the phone with the wardrobe open: back to portrait and on its side again.
      await page.setViewportSize({ width: size.height, height: size.width });
      await page.setViewportSize({ width: size.width, height: size.height });
      await settled(page);
      const again = await boxOf(page, '[data-testid="wardrobe-items"]');
      expect(again.b - again.t, 'room for clothes after turning').toBeGreaterThanOrEqual(64);
      await page.getByTestId('wardrobe-done').tap();
      await expect(wardrobe).toBeHidden();
    });
  }

  for (const size of LANDSCAPE_PHONES) {
    await test.step(`catalog, ${size.name}`, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openTray(page, 'adventure');
      await page.getByTestId('catalog-open').tap();
      const grid = page.getByTestId('catalog-grid');
      await expect(grid).toBeVisible();
      await settled(page);
      const sheet = await boxOf(page, '.catalog-scroll');
      expect(sheet.b - sheet.t, 'room for a row of squishies').toBeGreaterThanOrEqual(120);
      await expectReachable(page.getByTestId('catalog-close-top'), 'the round ×');
      await page.getByTestId('catalog-close-top').tap();
      await expect(grid).toBeHidden();
    });
  }
});

type Box = { l: number; t: number; r: number; b: number };

/** The boxes of every visible match of `selector`, as drawn. */
async function allBoxes(page: Page, selector: string): Promise<Box[]> {
  await still(page, selector);
  return page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((n) => !n.closest('[hidden]') && n.getClientRects().length > 0)
      .map((n) => {
        const b = n.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom };
      }),
  );
}

test('home, the roster, the team, chat and the heart pill fit a phone on its side', async ({
  browser,
}) => {
  test.setTimeout(240_000); // a map build and a home scene; CI renders in software
  const page = await newPlayer(browser, uniqueName('sides'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Sides Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();
  // A second squishy, so the roster and the team have two to put side by side.
  await (await trayButton(page, 'battle-dev-grant')).tap();
  await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  await closeTrays(page);

  for (const size of LANDSCAPE_PHONES) {
    await test.step(`heart pill, chat, roster, team and home, ${size.name}`, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await settled(page);
      // The pill's box is the 44pt tap target, whatever it looks like.
      await expectReachable(
        page.locator('[data-testid="heart-coins"][data-where="map"]'),
        'the map heart pill',
      );

      // Chat: low on the screen with no gap under it, the squishes to say on its right.
      await page.getByTestId('chat-open').tap();
      await expect(page.getByTestId('chat')).toBeVisible();
      const [chat] = await allBoxes(page, '.chat-sheet');
      const [feed] = await allBoxes(page, '.chat-feed');
      const [picks] = await allBoxes(page, '.chat-picker');
      expect(size.height - chat!.b, 'chat sits low').toBeLessThanOrEqual(16);
      expect(picks!.l, 'the picks are right of the feed').toBeGreaterThanOrEqual(feed!.r);
      await expectReachable(page.getByTestId('chat-close'), 'chat Close');
      await expectReachable(page.locator('.chat-pick').first(), 'the first thing to say');
      await page.getByTestId('chat-close').tap();
      await expect(page.getByTestId('chat')).toBeHidden();

      // The roster: two squishies on one line.
      await openRoster(page);
      await settled(page);
      const rows = await allBoxes(page, '[data-testid="roster-row"]');
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(Math.abs(rows[0]!.t - rows[1]!.t), 'two squishies a line').toBeLessThan(2);
      await expectReachable(page.getByTestId('roster-care').first(), 'the first Care');
      await closeRoster(page);

      // The team: the squishies in their own column, right of the slots and Save.
      await (await trayButton(page, 'team-open')).tap();
      const team = page.getByTestId('team');
      await expect(team).toBeVisible();
      const [slots] = await allBoxes(page, '[data-testid="team-slots"]');
      const [list] = await allBoxes(page, '[data-testid="team-list"]');
      expect(list!.l, 'the squishies are right of the slots').toBeGreaterThanOrEqual(slots!.r);
      await expectReachable(page.getByTestId('team-save'), 'Save team');
      await expectReachable(
        team.locator('[data-testid="team-candidate"]').first(),
        'the first squishy to pick',
      );
      await team.getByRole('button', { name: 'Close' }).tap();
      await expect(team).toBeHidden();

      // Home: a short bar that shares one line, then a sheet that stops under the title.
      await closeTrays(page);
      await (await trayButton(page, 'home-open')).tap();
      const sheet = page.getByTestId('home');
      await expect(sheet.getByTestId('home-handle')).toBeVisible();
      await settled(page);
      const [bar] = await allBoxes(page, '.home-sheet');
      expect(bar!.b - bar!.t, 'the peek bar stays short').toBeLessThanOrEqual(size.height * 0.34);
      const [squishies] = await allBoxes(page, '[data-testid="home-squishies"]');
      const [back] = await allBoxes(page, '[data-testid="home-back"]');
      expect(Math.abs(squishies!.t - back!.t), 'the shortcuts share a line').toBeLessThan(2);
      await expectReachable(sheet.getByTestId('home-back'), 'Back to map');
      await sheet.getByTestId('home-handle').tap();
      await expect(sheet.getByTestId('home-handle')).toHaveAttribute('aria-expanded', 'true');
      await settled(page);
      const [title] = await allBoxes(page, '.home-top');
      const [open] = await allBoxes(page, '.home-sheet');
      expect(open!.t, 'the open sheet stays under the title card').toBeGreaterThanOrEqual(title!.b);
      await sheet.getByTestId('home-handle').tap();
      await sheet.getByTestId('home-back').tap();
      await expect(sheet).toBeHidden();
    });
  }
});
