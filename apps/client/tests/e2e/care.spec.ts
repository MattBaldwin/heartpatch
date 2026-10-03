import { CARE_RULES, findAvoidedWords, moodFor } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

/**
 * Care (#19): open a squishy's care sheet from home base, pet, play and feed
 * it, and see an evolution celebrated once. Checked through the dev hook's
 * state and counters, never pixels or timing.
 */

interface CareDebug {
  squishyId: string | null;
  open: boolean;
  contentment: number | null;
  mood: string | null;
  level: number | null;
  speciesId: string | null;
  caredToday: number | null;
  celebrating: boolean;
  squishes: number;
  note: string;
}

type Hook = { __heartpatch?: { care?(): CareDebug | null; home?(): { open: boolean } | null } };

const careState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.care?.() ?? null);
const homeOpen = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.home?.()?.open ?? false);

/** A fresh player on their own patch with a squishy friend and a bag of stuff (dev tools). */
async function playerWithFriend(page: Page): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Care Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await page.getByTestId('bag-open').tap();
  await page.getByTestId('bag').getByRole('button', { name: 'Get stuff (dev)' }).tap();
  await slowExpect(page.getByTestId('bag').locator('[data-item="treats"]')).toContainText('10');
  await page.getByTestId('bag').getByRole('button', { name: 'Close' }).tap();
  await page.getByTestId('battle-dev-grant').tap();
  await slowExpect(page.locator('.battle-entry-note')).toContainText('joined you');
}

test('cares for a squishy from home base: pet, play and feed', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('care'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await playerWithFriend(page);

  await page.getByTestId('home-open').tap();
  await expect.poll(() => homeOpen(page), slow).toBe(true);
  await page.getByTestId('home-friends').locator('[data-care-squishy]').first().tap();
  const sheet = page.getByTestId('care');
  await slowExpect(sheet).toBeVisible();
  // A new squishy starts part content (care rules `startContentment`).
  const start = CARE_RULES.startContentment;
  const mood = (contentment: number) => moodFor(contentment, CARE_RULES);
  await expect.poll(async () => (await careState(page))?.mood, slow).toBe(mood(start));
  expect(await careState(page)).toMatchObject({ contentment: start, caredToday: 0, squishes: 0 });

  // Pet: more contentment, a squish, and a cheerful line.
  await sheet.locator('[data-care="pet"]').tap();
  await expect.poll(async () => (await careState(page))?.contentment, slow).toBe(start + 10);
  await slowExpect(page.getByTestId('care-note')).toContainText('So soft!');
  expect(await careState(page)).toMatchObject({
    caredToday: 1,
    mood: mood(start + 10),
    squishes: 1,
  });
  // The same action again straight away waits a moment (one gesture counts once),
  // then the button comes back on by itself.
  await slowExpect(sheet.locator('[data-care="pet"]')).toBeDisabled();
  await slowExpect(sheet.locator('[data-care="pet"]')).toContainText('Just a sec');
  await slowExpect(sheet.locator('[data-care="pet"]')).toBeEnabled();

  // Play, then feed a Treat.
  await sheet.locator('[data-care="play"]').tap();
  await expect.poll(async () => (await careState(page))?.contentment, slow).toBe(start + 20);
  await sheet.locator('[data-care="feed"]').tap();
  await expect.poll(async () => (await careState(page))?.contentment, slow).toBe(start + 40);
  await slowExpect(sheet.locator('[data-care="feed"]')).toContainText('9 Treats');
  expect(await careState(page)).toMatchObject({
    caredToday: 3,
    mood: mood(start + 40),
    squishes: 3,
  });

  // Kid-friendly words only (style guide §9).
  expect(findAvoidedWords((await sheet.textContent()) ?? '')).toEqual([]);

  await sheet.getByTestId('care-close').tap();
  await slowExpect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

test('celebrates an evolution once, when the player comes home', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('evolve'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await playerWithFriend(page);

  // Levelling to an evolution takes many battles, so the care list says one
  // just happened (the server's own evolution is covered by its tests).
  let evolved = false;
  await page.route('**/api/v1/maps/*/care', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      squishies: { speciesId: string; newEvolution: unknown }[];
    };
    const first = body.squishies[0];
    if (first && !evolved) {
      evolved = true;
      first.newEvolution = {
        fromSpeciesId: first.speciesId,
        intoSpeciesId: first.speciesId,
        level: 20,
        at: new Date().toISOString(),
      };
    }
    await route.fulfill({ response, json: body });
  });

  await page.getByTestId('home-open').tap();
  const sheet = page.getByTestId('care');
  await slowExpect(sheet).toBeVisible();
  await expect.poll(async () => (await careState(page))?.celebrating, slow).toBe(true);
  expect((await careState(page))?.squishes).toBe(1);
  await slowExpect(page.getByTestId('care-celebrate')).toContainText('grew into');

  // "Yay!" tells the server it was seen; the real reply has no evolution left.
  await page.getByTestId('care-yay').tap();
  await expect.poll(async () => (await careState(page))?.celebrating, slow).toBe(false);
  expect(findAvoidedWords((await sheet.textContent()) ?? '')).toEqual([]);
  expect(errors).toEqual([]);
});
