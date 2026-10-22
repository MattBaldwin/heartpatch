import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { keeperStill, nearestFirst, walkTo, waypoint } from './explore-walk.js';
import { realTapAt } from './touch.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Exploring a grey village tile (#306 2a): once my land touches a village
 * (the dev route), its tile panel's Explore opens the explore view drained
 * grey with a Hollow echo, its name and today's joy in the header. A search
 * opens a joy disc and bursts into sparks, inside the explore budget
 * (explore.spec.ts: under 46 draw calls and 420k triangles) and without
 * linking a shader program (the owner's find freezes, #555 and #569).
 * The square is the Hollow's heart: its first search finds the last torn
 * page, which wakes its broken thing's forgotten story (#306). It opens from
 * the big button: a wrong order shows how many were right and the ink
 * shifts to a new try, and telling the day right gives a lore page; mended,
 * it keeps its colour. (Relight the path, on the other tiles, is played
 * through in its unit tests.) Checked through the dev hook.
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
  near: number | null;
  toast: string | null;
  card: 'rare' | null;
  puzzle: {
    card: 'loading' | 'board' | 'reward';
    outcome: 'playing' | 'won' | 'faded' | null;
    attempt: number | null;
    size: number | null;
    moves: number;
    limit: number | null;
    lit: number;
    lanterns: number;
    picked: number | null;
    kind: 'relight' | 'story' | null;
    places: number;
    placed: string[];
    story: 'playing' | 'telling' | 'smudged' | null;
    right: number | null;
  } | null;
  brokenThing: { x: number; z: number; skin: string; solved: boolean } | null;
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
      puzzle: 'broken' | 'fixed' | null;
    } | null;
  } | null;
}

const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const hitchesExpected = (page: Page) => hook<number>(page, 'hitchesExpected');

test('a grey village tile explores drained, with an echo, a find colours it in, and its broken thing mends (#306 2a, 2b)', async ({
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
  // Every torn page of the Hollow found but the heart's own (dev only).
  const pages = await api<{ found: number; total: number }>(
    page,
    'POST',
    `/maps/${mapId}/dev/story-pages`,
    { ...square, leave: 1 },
  );
  expect(pages.body.found).toBe(pages.body.total - 1);
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
  // Restoring opens by day too (#306 PR 3).
  await expect(page.getByTestId('community-restore')).toBeEnabled();
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
    const fits = await page.locator(sel).evaluate(
      (e) =>
        // An emoji's taller glyph may overhang the line box a pixel or two.
        e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight + 2 && e.clientWidth > 0,
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
    puzzle: 'broken',
  });
  expect(first.brokenThing).toMatchObject({ solved: false });

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
    // The heart's own torn page, the last one: the story wakes.
    expect(after.card).toBe('rare');
    await slowExpect(sheet).toBeVisible();
    await expect(sheet.getByTestId('explore-finds')).toContainText('A torn page! 📜');
    await expect(sheet.getByTestId('explore-finds')).toContainText('Every page found!');
    await sheet.getByTestId('explore-yay').tap();
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

  // The forgotten story (#306): walk up to the broken thing.
  const broken = first.brokenThing!;
  for (let tries = 0; tries < 10 && (await exploreState(page))?.near !== -1; tries++) {
    const tap = await waypoint(page, broken);
    if (!tap) break;
    await realTapAt(page, tap.x, tap.y);
    await keeperStill(page);
  }
  expect((await exploreState(page))?.near, 'walked up to the broken thing').toBe(-1);
  await expect(action).toHaveText(/Fix the /);
  await action.tap();
  const card = page.getByTestId('hollowed-puzzle');
  await slowExpect(card).toBeVisible();
  await expect.poll(async () => (await exploreState(page))?.puzzle?.card, slow).toBe('board');
  const shown = (await exploreState(page))!.puzzle!;
  expect(shown).toMatchObject({ kind: 'story', story: 'playing', attempt: 1, placed: [] });
  // One clue a tile, on its torn page.
  await expect(card.locator('.hollowed-story-page')).toHaveCount(pages.body.total);
  // Its buttons stay in reach while the pages scroll (render-check: 375×667).
  for (const id of ['hollowed-story-tell', 'hollowed-puzzle-not-now']) {
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByTestId('hollowed-story-tell')).toBeDisabled();
  const widths = await card.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(widths[0], 'the card never scrolls sideways').toBeLessThanOrEqual(widths[1]!);
  const tray = page.getByTestId('hollowed-story-tray');
  const slots = page.getByTestId('hollowed-story-slots');
  /** Taps the moments into their places, first to last, through the real card. */
  async function tellOrder(order: readonly string[]): Promise<void> {
    for (const id of order) await tray.locator(`[data-moment="${id}"]`).tap();
    await expect.poll(async () => (await exploreState(page))?.puzzle?.placed).toEqual(order);
    await page.getByTestId('hollowed-story-tell').tap();
  }
  const answerOf = () =>
    api<{ attempt: number; order: string[] }>(
      page,
      'POST',
      `/maps/${mapId}/dev/story-answer`,
      square,
    );
  const first1 = await answerOf();
  expect(first1.body.attempt).toBe(1);
  // A placed moment taps back to the tray.
  await tray.locator(`[data-moment="${first1.body.order[0]!}"]`).tap();
  await slots.locator('.hollowed-story-slot-on').first().tap();
  await expect.poll(async () => (await exploreState(page))?.puzzle?.placed).toEqual([]);
  // A wrong order: the places show right or wrong, and the ink shifts to a new try.
  await tellOrder([...first1.body.order].reverse());
  await slowExpect(page.getByTestId('hollowed-story-smudged')).toBeVisible();
  await expect(page.getByTestId('hollowed-puzzle-line')).toContainText(`were in the right place`);
  await expect(slots.locator('.hollowed-story-slot-wrong').first()).toBeVisible();
  await page.getByTestId('hollowed-story-new-pages').tap();
  await expect.poll(async () => (await exploreState(page))?.puzzle?.attempt, slow).toBe(2);
  await expect.poll(async () => (await exploreState(page))?.puzzle?.story).toBe('playing');
  // Tell the new day right through the real card: the dev answer's order.
  const second = await answerOf();
  expect(second.body.attempt).toBe(2);
  await tellOrder(second.body.order);
  await slowExpect(page.getByTestId('hollowed-puzzle-finds')).toBeVisible();
  await expect(page.getByTestId('hollowed-puzzle-finds')).toContainText('A lore page!');
  await page.getByTestId('hollowed-puzzle-yay').tap();
  await expect(card).toBeHidden();
  const mended = (await exploreState(page))!;
  expect(mended.brokenThing?.solved).toBe(true);
  expect(mended.scene?.hollowed?.puzzle).toBe('fixed');
  expect(mended.near).not.toBe(-1);
  await page.waitForTimeout(2000);
  const after = (await exploreState(page))!.scene!;
  test.info().annotations.push({ type: 'mendedDrawCalls', description: String(after.drawCalls) });
  expect(after.drawCalls).toBeLessThan(DRAW_CALL_CEILING);
  expect(errors).toEqual([]);
});
