import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
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

// Picked as the worker loads this file, just before its one test runs.
test.use({ timezoneId: duskTimeZone() });

const hollowState = (page: Page) =>
  hook<{ mapId: string; night: boolean; chips: string[]; darkSpots: number }>(page, 'hollow');
const mapState = (page: Page) => hook<{ id: string; live: string | null }>(page, 'map');

async function openMap(page: Page): Promise<void> {
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
}

test('at dusk, dark land gets a nudge to light a fire', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('dusk'));
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

  // Land outside home with no fire (the dev route that walks my land to a post).
  expect((await api(page, 'POST', `/maps/${mapId}/dev/posts/connect`)).status).toBe(200);
  await page.reload();
  await openMap(page);
  await expect.poll(async () => (await hollowState(page))?.darkSpots).toBeGreaterThan(0);
  const state = (await hollowState(page))!;
  expect(state.night).toBe(false);
  expect(state.chips[0]).toBe('night-in');
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText('dark tonight!');
  expect(findAvoidedWords((await nudge.textContent()) ?? '')).toEqual([]);

  // "Show me" answers it for tonight: it stays away, even after a reload.
  await nudge.getByTestId('night-nudge-show').tap();
  await expect(nudge).toBeHidden();
  await page.reload();
  await openMap(page);
  await expect.poll(async () => (await hollowState(page))?.darkSpots).toBeGreaterThan(0);
  await expect(nudge).toBeHidden();
});
