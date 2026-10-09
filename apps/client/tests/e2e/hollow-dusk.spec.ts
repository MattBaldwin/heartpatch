import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { claimLand } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { duskTimeZone } from './map-time.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The dark-land nudge (#277) at dusk. Every other spec plays by day (map
 * time is pinned, #326); this one opts into dusk on purpose: its patch is
 * made in a time zone where it's the hour before nightfall right now. Land
 * outside home with no fire is dark, so the nudge asks for a fire there,
 * and once answered it stays away for the rest of tonight.
 */

const hollowState = (page: Page) =>
  hook<{ mapId: string; night: boolean; chips: string[]; darkSpots: number }>(page, 'hollow');
const mapState = (page: Page) => hook<{ id: string; live: string | null }>(page, 'map');

async function openMap(page: Page): Promise<void> {
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
}

test('at dusk, dark land gets a nudge to light a fire', async ({ browser }) => {
  // A claim's showdown (CI renders in software), and up to 10 minutes'
  // wait for a zone with enough dusk left.
  test.setTimeout(840_000);
  const page = await newPlayer(browser, uniqueName('dusk'), undefined, {
    timezoneId: await duskTimeZone(),
  });
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Dusky Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await openMap(page);
  const mapId = (await mapState(page))!.id;
  const nudge = page.getByTestId('night-nudge');
  // Home alone is always safe: no nudge, even at dusk.
  await expect.poll(async () => (await hollowState(page))?.mapId).toBe(mapId);
  await expect(nudge).toBeHidden();

  // Land outside home with no fire. Claiming old forest finds a lore page,
  // whose card would come first on the next map open (one card at a time):
  // mark it seen, as hollow.spec.ts does.
  await claimLand(page, mapId);
  const me = (await api<{ user: { id: string } }>(page, 'GET', '/me')).body.user.id;
  await page.evaluate((key) => {
    const shown = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    localStorage.setItem(key, JSON.stringify([...shown, 'the-tidied-clearing']));
  }, `heartpatch.lore.shown.${me}`);
  await page.reload();
  await openMap(page);
  await expect.poll(async () => (await hollowState(page))?.darkSpots).toBe(1);
  const state = (await hollowState(page))!;
  expect(state.night).toBe(false);
  expect(state.chips[0]).toMatch(/Night in \d+ min/);
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText('dark tonight!');
  expect(findAvoidedWords((await nudge.textContent()) ?? '')).toEqual([]);

  // "Show me" answers it for tonight: it stays away, even after a reload.
  await nudge.getByTestId('night-nudge-show').tap();
  await expect(nudge).toBeHidden();
  await page.reload();
  await openMap(page);
  await expect.poll(async () => (await hollowState(page))?.darkSpots).toBe(1);
  await expect(nudge).toBeHidden();
});
