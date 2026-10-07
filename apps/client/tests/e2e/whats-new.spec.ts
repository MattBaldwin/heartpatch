import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

// What's new (#220). The dev server builds changelog.json from changes/*.md
// (tooling/changelog), so the menu test reads the real entries. The pop-up
// test serves its own changelog, so it can tell new entries from seen ones.

const SEEN_BUILD_KEY = 'heartpatch.whatsNewSeenBuild';

async function makePatch(page: Page, answerHint = true): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('News Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  // Sprout's first-time tray hint keeps What's new waiting until it's answered.
  if (answerHint) await page.getByTestId('tray-hint-ok').tap();
}

/** This app's build number, from the version line. */
async function appBuild(page: Page): Promise<number> {
  const menu = page.getByTestId('keeper-menu');
  await menu.tap();
  const version = (await page.getByTestId('app-version').textContent()) ?? '';
  await menu.tap();
  const build = Number(/^v0\.(\d+)/.exec(version)?.[1]);
  expect(build).toBeGreaterThan(0);
  return build;
}

test('tapping the version line opens What’s new with the real entries', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('news'));
  await makePatch(page);

  const sheet = page.getByTestId('whats-new');
  // A brand-new device never pops the whole history up.
  await expect(sheet).toBeHidden();

  await page.getByTestId('keeper-menu').tap();
  await page.getByTestId('app-version').tap();
  await expect(sheet).toBeVisible();
  // The menu folds away, so it doesn't sit over the sheet.
  await expect(page.getByTestId('keeper-menu')).toHaveAttribute('aria-expanded', 'false');
  // Level 2: the sheet's own title. An entry can be called "What's new" too.
  await expect(sheet.getByRole('heading', { name: 'What’s new', level: 2 })).toBeVisible();
  await expect(sheet.locator('[data-entry="220-whats-new"]')).toBeVisible();
  // The browser may refuse the clipboard; either way the chip answers.
  await sheet.getByRole('button', { name: 'Copy' }).tap();
  await expect(sheet.locator('.whats-new-copy')).toHaveText(/^(Copied!|Write it down instead)$/);
  expect((await hook<{ mode: string }>(page, 'whatsNew'))?.mode).toBe('menu');

  await sheet.getByRole('button', { name: 'Yay!' }).tap();
  await expect(sheet).toBeHidden();
  await page.context().close();
});

test('after an update What’s new pops up once, new things first', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('pop'));
  await makePatch(page, false);
  const build = await appBuild(page);

  const entry = (slug: string, title: string, at: number) => ({
    slug,
    title,
    area: 'other',
    body: `${title}, for a test.`,
    tryIt: null,
    build: at,
    date: '2026-10-07',
  });
  await page.route('**/changelog.json', (route) =>
    route.fulfill({
      json: {
        entries: [
          entry('new-thing', 'A new thing', build),
          entry('old-thing', 'An old thing', build - 5),
        ],
      },
    }),
  );
  // This device last looked a few builds ago.
  await page.evaluate(
    ([key, seen]) => {
      localStorage.setItem(key, seen);
    },
    [SEEN_BUILD_KEY, String(build - 3)] as const,
  );
  // A reload goes straight back to the patch.
  await page.reload();
  await expect(page.getByTestId('map-hud')).toContainText('News Patch', { timeout: 30_000 });

  // It waits for Sprout's tray hint, then pops up.
  const sheet = page.getByTestId('whats-new');
  const hint = page.getByTestId('tray-hint');
  await expect(hint).toBeVisible();
  await page.waitForTimeout(4_000); // longer than a busy retry
  await expect(sheet).toBeHidden();
  await page.getByTestId('tray-hint-ok').tap();
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole('heading', { name: 'What’s new!' })).toBeVisible();
  const dividers = sheet.getByRole('separator');
  await expect(dividers).toHaveText(['New since you last looked', 'You’ve seen these']);
  await expect(sheet.locator('article h4')).toHaveText(['A new thing', 'An old thing']);
  expect((await hook<{ mode: string }>(page, 'whatsNew'))?.mode).toBe('update');

  await sheet.getByRole('button', { name: 'Yay!' }).tap();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_BUILD_KEY)).toBe(
    String(build),
  );

  // Once only: the next visit stays quiet.
  await page.reload();
  await expect(page.getByTestId('map-hud')).toContainText('News Patch', { timeout: 30_000 });
  await page.waitForTimeout(4_000); // longer than a busy retry
  await expect(sheet).toBeHidden();
  await page.context().close();
});
