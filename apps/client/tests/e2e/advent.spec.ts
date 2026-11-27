import {
  AdventViewSchema,
  ClaimAdventResponseSchema,
  findAvoidedWords,
  type AdventDayView,
  type AdventView,
} from '@heartpatch/shared';
import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * The advent calendar sheet (#37 1d): a "Presents" row in the My Home tray in
 * December, the 5×5 grid, "Open today's present", one missed day, and the
 * reveal. The server's rules are its own tests' (modules/advent); this checks
 * the client draws what a server says and sends only the day tapped. The
 * suite's game clock sits in October (playwright.config.ts), so the bag's
 * reply is moved into December (the client takes its season from it) and the
 * calendar is a stand-in that must still parse as the shared contract.
 */

interface AdventDebug {
  mapId: string;
  open: boolean;
  waiting: boolean;
  days: string[] | null;
  reveal: string[] | null;
  note: string;
}

const adventState = (page: Page) => hook<AdventDebug>(page, 'advent');

const DECEMBER_NOW = '2026-12-05T15:00:00.000Z';
const day = (n: number) => `2026-12-${String(n).padStart(2, '0')}`;
const CONTENTS = ['treats', 'pies', 'heartdust'];

/** Today is the 5th: 1 and 4 are opened, 2 and 3 can be caught up, the rest are still wrapped. */
function calendar(opened: number[], catchUpLeft: boolean): AdventView {
  const days: AdventDayView[] = Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    if (opened.includes(n)) {
      return { day: day(n), state: 'opened', items: { treats: 2 }, contents: CONTENTS };
    }
    const state = n > 5 ? 'locked' : n === 5 ? 'today' : catchUpLeft ? 'catch-up' : 'missed';
    return { day: day(n), state, contents: CONTENTS };
  });
  return AdventViewSchema.parse({
    today: day(5),
    days,
    catchUpLeft,
    presentContents: ['treats'],
  });
}

/** A December bag clock, and a calendar the spec keeps: what it was asked to open is recorded. */
async function stubDecember(page: Page) {
  const claimed: string[] = [];
  let opened = [1, 4];
  let catchUpLeft = true;
  await page.route(/\/maps\/[^/]+\/inventory$/, async (route) => {
    const reply = await route.fetch();
    const body = (await reply.json()) as { now: string };
    await route.fulfill({ response: reply, json: { ...body, now: DECEMBER_NOW } });
  });
  await page.route(/\/maps\/[^/]+\/advent$/, (route) =>
    route.fulfill({ json: calendar(opened, catchUpLeft) }),
  );
  await page.route(/\/maps\/[^/]+\/advent\/claim$/, (route) => {
    const { day: asked } = route.request().postDataJSON() as { day: string };
    claimed.push(asked);
    const n = Number(asked.slice(8));
    const catchUp = n !== 5;
    opened = [...opened, n];
    if (catchUp) catchUpLeft = false;
    return route.fulfill({
      json: ClaimAdventResponseSchema.parse({
        opened: { day: asked, catchUp, items: { treats: 3, pies: 1 } },
        advent: calendar(opened, catchUpLeft),
      }),
    });
  });
  return { claimed };
}

test('opens today, then the one I missed, and shows what came out (#37 1d)', async ({
  browser,
}) => {
  test.setTimeout(180_000); // a full map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('advnt'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const server = await stubDecember(page);

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Present Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();

  // Today's present is waiting: the row has its badge.
  await expect.poll(async () => (await adventState(page))?.waiting, { timeout: 30_000 }).toBe(true);
  const entry = await trayButton(page, 'advent-open');
  await expect(entry).toContainText('Presents');
  await expect(entry.locator('[data-tray-alert]')).toBeVisible();
  await entry.tap();

  const sheet = page.getByTestId('advent-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Day \d+,/ })).toHaveCount(25);
  expect((await adventState(page))?.days?.slice(0, 7)).toEqual([
    'opened',
    'catch-up',
    'catch-up',
    'opened',
    'today',
    'locked',
    'locked',
  ]);
  // Today and catch-up read differently without colour: a word and a picture each.
  await expect(sheet.getByTestId('advent-day-5')).toContainText('Today');
  await expect(sheet.getByTestId('advent-day-3')).toContainText('Catch up');
  await expect(sheet.getByTestId('advent-day-3')).toHaveAttribute('aria-label', /missed/);
  await expect(sheet.getByTestId('advent-day-1')).toContainText('Opened');
  await expect(sheet.getByTestId('advent-day-8')).toContainText('Wrapped');
  await expect(sheet.getByTestId('advent-day-24')).toContainText('🎆');
  await expect(sheet.getByTestId('advent-day-25')).toContainText('⭐');
  // What it might hold: names, never odds.
  const holds = sheet.getByTestId('advent-contents');
  await expect(holds).toContainText("Today's present might hold:");
  await expect(holds).toContainText('Treats');
  await expect(holds).not.toContainText(/%|chance|odds/i);

  // Tap targets 44 pt, and no player-facing text under 14 px.
  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  const smallText = await sheet.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('*')]
      .filter(
        (node) =>
          [...node.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim()) &&
          Number.parseFloat(getComputedStyle(node).fontSize) < 14,
      )
      .map((node) => node.textContent),
  );
  expect(smallText).toEqual([]);
  expect(findAvoidedWords((await sheet.textContent()) ?? '')).toEqual([]);

  // A still-wrapped day says so, kindly, without asking the server.
  // The note has its own one-line slot: the sheet keeps its size and its place.
  const before = await sheet.boundingBox();
  await sheet.getByTestId('advent-day-9').tap();
  await expect(sheet.getByTestId('advent-note')).toContainText('wrapped up tight');
  expect(await sheet.boundingBox()).toEqual(before);
  expect(server.claimed).toEqual([]);

  // Open today's: the day tapped is what's sent, and the reveal shows what came out.
  await sheet.getByTestId('advent-open-today').tap();
  const reveal = sheet.getByTestId('advent-reveal');
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText("Today's present had");
  await expect(sheet.getByTestId('advent-found')).toContainText('3 ×');
  await expect(sheet.getByTestId('advent-found')).toContainText('Pies');
  expect(server.claimed).toEqual([day(5)]);
  expect((await adventState(page))?.waiting).toBe(false);
  await sheet.getByTestId('advent-yay').tap();
  await expect(reveal).toBeHidden();
  await expect(sheet.getByTestId('advent-day-5')).toContainText('Opened');
  await expect(sheet.getByTestId('advent-status')).toContainText('Come back tomorrow');
  await expect(sheet.getByTestId('advent-open-today')).toHaveCount(0);

  // The one I missed: the button names the oldest day, a tap on another picks it,
  // and the server hears the day picked.
  const missed = sheet.getByTestId('advent-open-missed');
  await expect(missed).toHaveText('Open the one I missed (Day 2)');
  await sheet.getByTestId('advent-day-3').tap();
  await expect(missed).toHaveText('Open the one I missed (Day 3)');
  await missed.tap();
  await expect(sheet.getByTestId('advent-reveal')).toContainText('Day 3 had');
  expect(server.claimed).toEqual([day(5), day(3)]);
  await sheet.getByTestId('advent-yay').tap();

  // Catch-up is used: no button, a kind line, and the day left behind says so when tapped.
  await expect(sheet.getByTestId('advent-open-missed')).toHaveCount(0);
  await expect(sheet.getByTestId('advent-day-2')).toContainText('Missed');
  await sheet.getByTestId('advent-day-2').tap();
  await expect(sheet.getByTestId('advent-note')).toContainText('More tomorrow');
  await expect(sheet.getByTestId('advent-used')).toContainText('Come back tomorrow');
  await sheet.getByTestId('advent-close').tap();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

test('a reveal holds still with Reduce Motion on (#37 1d)', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('advrm'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubDecember(page);
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Still Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect.poll(async () => (await adventState(page))?.waiting, { timeout: 30_000 }).toBe(true);
  await (await trayButton(page, 'advent-open')).tap();
  const sheet = page.getByTestId('advent-sheet');
  // Today's cell doesn't bob.
  await expect(sheet.getByTestId('advent-day-5')).toBeVisible();
  expect(
    await sheet
      .getByTestId('advent-day-5')
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe('none');
  await sheet.getByTestId('advent-open-today').tap();
  const gift = sheet.locator('.advent-gift');
  await expect(gift).toBeVisible();
  expect(await gift.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});
