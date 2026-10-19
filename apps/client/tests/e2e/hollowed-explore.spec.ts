import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { nearestFirst, walkTo } from './explore-walk.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Exploring a grey village tile (#306 2a): once my land touches a village
 * (the dev route), its tile panel's Explore opens the explore view drained
 * grey with a Hollow echo, its name and today's joy in the header. A search
 * opens a joy disc and bursts into sparks, inside the explore budget
 * (explore.spec.ts: under 46 draw calls and 420k triangles) and without
 * linking a shader program (the owner's find freezes, #555 and #569).
 * Checked through the dev hook.
 */

const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };
/** explore.spec.ts's budget: a Hollowed meadow with an echo stays under it too (plan v3). */
const DRAW_CALL_CEILING = 46;
const TRIANGLE_CEILING = 420_000;

interface ExploreDebug {
  open: boolean;
  tile: { q: number; r: number; terrain: string } | null;
  progress: { searched: number; total: number } | null;
  spots: {
    index: number;
    kind: string;
    tool: string | null;
    done: boolean;
    x: number;
    z: number;
  }[];
  keeper: { x: number; z: number };
  toast: string | null;
  card: 'rare' | null;
  scene: {
    keeper: boolean;
    drawCalls: number;
    triangles: number;
    warm: boolean;
    gl: { buffers: number; programs: number } | null;
    land: { tier: string } | null;
    hollowed: {
      drain: number;
      discs: number;
      sparks: number;
      bursts: number;
      echoes: number;
      echoAt: { x: number; z: number }[];
    } | null;
  } | null;
}

const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const hitchesExpected = (page: Page) => hook<number>(page, 'hitchesExpected');

test('a grey village tile explores drained, with an echo, and a find colours it in (#306 2a)', async ({
  browser,
}) => {
  test.setTimeout(300_000); // a scene build, a walk and a find; CI renders in software
  const page = await newPlayer(browser, uniqueName('hollowed'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Grey Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  // My land reaches my nearest village (dev only) before the map opens.
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Grey Patch')!.id;
  const reach = await api<{ q: number; r: number }>(
    page,
    'POST',
    `/maps/${mapId}/dev/hollowed-reach`,
  );
  expect(reach.status, JSON.stringify(reach.body)).toBe(201);
  const square = reach.body;
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const explore = page.getByTestId('community-explore');
  await expect(async () => {
    await page.evaluate(
      ({ q, r }) =>
        (
          window as unknown as {
            __heartpatch?: { mapDev?: () => { show(q: number, r: number): boolean } };
          }
        ).__heartpatch
          ?.mapDev?.()
          .show(q, r),
      square,
    );
    await expect(explore).toBeEnabled({ timeout: 5_000 });
  }).toPass(slow);
  // Restoring waits for its own PR, and says so.
  await expect(page.getByTestId('community-restore')).toBeDisabled();
  await expect(page.getByTestId('community-block')).toContainText('Explore by day');
  await explore.tap();

  await expect.poll(async () => (await exploreState(page))?.scene?.keeper, slow).toBe(true);
  const first = (await exploreState(page))!;
  expect(first.tile).toMatchObject(square);
  // The village's name and today's joy in the header, never cut off.
  await expect(page.locator('.explore-title')).toHaveText(/Hollow 🕯️$/);
  await expect(page.getByTestId('explore-progress')).toHaveText(
    `0 of ${String(first.spots.length)} found 🔍`,
  );
  const joyMeter = page.getByTestId('explore-joy');
  await expect(joyMeter).toBeVisible();
  await expect(joyMeter).toHaveAttribute('aria-label', 'Joy 0% ✨');
  for (const sel of ['.explore-title', '.explore-progress']) {
    const fits = await page
      .locator(sel)
      .evaluate(
        (e) =>
          e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight && e.clientWidth > 0,
      );
    expect(fits, `${sel} fits`).toBe(true);
  }
  // Drained grey, nothing coloured back yet, one echo drifting.
  expect(first.scene?.hollowed).toMatchObject({
    drain: 1,
    discs: 0,
    sparks: 0,
    bursts: 0,
    echoes: 1,
  });

  // The budget on a settled frame, and every program compiled before the first tap.
  await expect.poll(async () => (await exploreState(page))?.scene?.warm ?? false, slow).toBe(true);
  await expect
    .poll(() => exploreState(page).then((s) => s?.scene?.drawCalls ?? 0), slow)
    .toBeGreaterThan(0);
  const settled = (await exploreState(page))!.scene!;
  test.info().annotations.push({ type: 'drawCalls', description: String(settled.drawCalls) });
  test.info().annotations.push({ type: 'triangles', description: String(settled.triangles) });
  expect(settled.drawCalls).toBeLessThan(DRAW_CALL_CEILING);
  expect(settled.triangles).toBeLessThan(TRIANGLE_CEILING);

  // Walk up to a spot searched by hand and search it the easy way.
  const action = page.getByTestId('explore-action');
  const sheet = page.getByTestId('explore-sheet');
  let found: ExploreDebug | null = null;
  for (const hands of nearestFirst(
    first.spots.filter((s) => s.tool === null),
    first.keeper,
  ).slice(0, 5)) {
    if (!(await walkTo(page, hands.index))) continue;
    await slowExpect(action).toBeEnabled();
    await action.tap();
    await slowExpect(page.getByTestId('explore-play')).toBeVisible();
    const before = (await exploreState(page))!;
    const hitches = (await hitchesExpected(page)) ?? 0;
    // Some easy ways take a few taps ("1 of 3"): until the gesture's done.
    const play = page.getByTestId('explore-play');
    for (let i = 0; i < 8 && (await play.isVisible()); i++) {
      await page.getByTestId('explore-easy').tap();
      await page.waitForTimeout(250);
    }
    // The burst plays while its disc opens: read the sparks as they fly.
    let sparks = 0;
    let burstCalls = 0;
    await expect
      .poll(async () => {
        const s = (await exploreState(page))!;
        sparks = Math.max(sparks, s.scene?.hollowed?.sparks ?? 0);
        if ((s.scene?.hollowed?.sparks ?? 0) > 0) {
          burstCalls = Math.max(burstCalls, s.scene?.drawCalls ?? 0);
        }
        return s.spots.find((x) => x.index === hands.index)?.done ?? false;
      }, slow)
      .toBe(true);
    await page.waitForTimeout(2000);
    const after = (await exploreState(page))!;
    // One disc open, one burst played (and done: no sparks left in the air).
    expect(after.scene?.hollowed).toMatchObject({ discs: 1, bursts: 1, sparks: 0 });
    test.info().annotations.push({ type: 'burstDrawCalls', description: String(burstCalls) });
    if (burstCalls > 0) expect(burstCalls).toBeLessThan(DRAW_CALL_CEILING);
    // A find links no shader program (dev builds count them; null on WebGPU),
    // and tells the governor to expect the hitch, as on my own land.
    const programs = (s: ExploreDebug) => s.scene?.gl?.programs;
    if (programs(before) !== undefined && after.scene?.land?.tier === before.scene?.land?.tier) {
      expect(programs(after), 'programs linked by the find').toBe(programs(before));
    }
    expect(await hitchesExpected(page)).toBeGreaterThanOrEqual(hitches + 2);
    test.info().annotations.push({ type: 'sparksSeen', description: String(sparks) });
    if (after.card === 'rare') {
      await slowExpect(sheet).toBeVisible();
      await sheet.getByTestId('explore-yay').tap();
    }
    found = after;
    break;
  }
  expect(found, 'searched a hand spot').not.toBeNull();
  const total = String(first.spots.length);
  const joy = Math.round(100 / first.spots.length);
  await expect(page.getByTestId('explore-progress')).toHaveText(`1 of ${total} found 🔍`);
  await expect(joyMeter).toHaveAttribute('aria-valuenow', String(joy));
  await expect(joyMeter).toHaveAttribute('aria-label', `Joy ${String(joy)}% ✨`);
  expect(findAvoidedWords((await page.locator('.explore-title').textContent()) ?? '')).toEqual([]);
  expect(errors).toEqual([]);
});
