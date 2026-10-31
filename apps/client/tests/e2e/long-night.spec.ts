import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook, idle, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The Long Night (#727e). The owner picks the patch's weekday (the server
 * works out when it comes, rule 4); the chip over the map counts down to it
 * by day. Tonight's nightfall is a Long Night: the live show narrates every
 * Keeper's walk in one feed by name, the reveal says the patch held (a new
 * patch's Keepers are graced, so they hold), and the Gap says it's closed
 * in the server's words until it opens. "Go look" itself needs the map's
 * clock past 7:30 PM, which the dev route can't move: `gapReply` in
 * long-night.test.ts covers its replies. Asserts on game signals (the dev
 * hook), not pixels.
 */

interface LongNightDebug {
  chip: string | null;
  notice: boolean;
  reveal: string | null;
  revealGoLook: boolean;
  gap: 'none' | 'available' | 'had';
  gapCard: string | null;
}
interface HollowDebug {
  mapId: string;
  chips: string[];
  show: { playing: boolean; feed: string[] };
  longNight: LongNightDebug;
}
interface HollowStatus {
  tonight: { night: string };
  longNight?: { weekday: number | null; gap: { available: boolean } | null };
}

const hollowState = (page: Page) => hook<HollowDebug>(page, 'hollow');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

test('a Long Night: the countdown, the live feed, the reveal and the crown', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const name = uniqueName('night');
  const page = await newPlayer(browser, name);
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Moonberry');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await waitForLiveMap(page);
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;
  await expect.poll(async () => (await hollowState(page))?.mapId, { timeout: 30_000 }).toBe(mapId);

  // The switch is on for this suite, and a new patch starts on Saturday.
  const read = async () =>
    (await api<{ hollow: HollowStatus }>(page, 'GET', `/maps/${mapId}/hollow`)).body.hollow;
  const first = await read();
  expect(first.longNight?.weekday).toBe(6);
  // Tonight's map-local weekday (map time is pinned to the late morning, #326).
  const today = new Date(`${first.tonight.night}T12:00:00Z`).getUTCDay();
  const pick = async (weekday: number) => {
    const set = await api(page, 'POST', `/maps/${mapId}/long-night`, { weekday });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
  };

  // Two days out: the chip counts the days, and its sheet names the day.
  const soon = (today + 2) % 7;
  await pick(soon);
  await expect
    .poll(async () => (await hollowState(page))?.longNight.chip, { timeout: 30_000 })
    .toBe('🌑 Long Night in 2 days');
  await page.getByTestId('long-night-chip').tap();
  const notice = page.getByTestId('long-night-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(
    `He'll come looking on ${DAYS[soon] ?? ''}. Stock your fires!`,
  );
  expect(findAvoidedWords((await notice.textContent()) ?? '')).toEqual([]);
  await notice.getByTestId('long-night-notice-ok').tap();
  await expect(notice).toBeHidden();

  // Tonight: "tonight!" by day.
  await pick(today);
  await expect
    .poll(async () => (await hollowState(page))?.longNight.chip, { timeout: 30_000 })
    .toBe('🌑 Long Night tonight!');

  // Night falls: tonight is the Long Night.
  const fell = await api<{ night: string }>(page, 'POST', `/maps/${mapId}/dev/nightfall`);
  expect(fell.status, JSON.stringify(fell.body)).toBe(200);
  expect(fell.body.night).toBe(first.tonight.night);
  await expect
    .poll(async () => (await hollowState(page))?.show.playing, { timeout: 30_000 })
    .toBe(true);
  // The feed tells every walk by name (mine in gold), never naming lost land.
  await expect
    .poll(async () => (await hollowState(page))?.show.feed.join('|'), { timeout: 30_000 })
    .toContain(`${name}'s`);
  await expect(page.getByTestId('night-feed')).toBeVisible();
  await page.getByTestId('night-show-skip').tap();
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);

  // The reveal: the patch held, the Gap is open, and my look waits.
  const reveal = page.getByTestId('long-night-reveal');
  await expect(reveal).toBeVisible({ timeout: 30_000 });
  await expect(reveal).toContainText('The patch held! 🎉');
  await expect(reveal).toContainText("Juniper's Gap is open till tomorrow night.");
  expect(findAvoidedWords((await reveal.textContent()) ?? '')).toEqual([]);
  // The dev route makes night fall by day (map time is pinned to the late
  // morning): the Gap opens at the strike, 7:30 PM map time, so it isn't
  // open yet. The reveal says so with no "Go look"; one tap closes it.
  expect((await read()).longNight?.gap ?? null).toBeNull();
  expect((await hollowState(page))?.longNight.revealGoLook).toBe(false);
  await reveal.getByTestId('long-night-ok').tap();
  await expect(reveal).toBeHidden();
  await expect.poll(async () => (await hollowState(page))?.longNight.reveal).toBeNull();
  // Asked early, the Gap says it's closed, in the server's own words (the client shows them as sent).
  const early = await api<{ error: { code: string; message: string } }>(
    page,
    'POST',
    `/maps/${mapId}/long-night/gap-encounter`,
  );
  expect(early.status).toBe(409);
  expect(early.body.error.message).toContain("Juniper's Gap is closed");
  // Keeper of the Night goes by fires lit: a new patch has none, so nobody
  // is crowned yet and the stats say so (the crown row is unit-tested).
  const stats = await api<{ keeperOfTheNight?: { userId: string } | null }>(
    page,
    'GET',
    `/maps/${mapId}/stats`,
  );
  expect(stats.status).toBe(200);
  expect(stats.body.keeperOfTheNight ?? null).toBeNull();
});
