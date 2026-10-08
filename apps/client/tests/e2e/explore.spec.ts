import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTapAt } from './touch.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

/**
 * The performance budget (CLAUDE.md rule 8): a settled explore frame draws
 * under this many calls. Measured at 41 on the iPhone and iPad viewports
 * (#291: tile, island, spot props, three decor kinds, glints, the Keeper's
 * batches, the team, the tool in hand, post-processing); headroom for a
 * busier tile (more prop kinds, buildings, a bigger team).
 */
const DRAW_CALL_CEILING = 60;

/**
 * Exploring your land (#199, cozy-sim feel #291): Explore on a home tile
 * opens it up close with a follow camera and an always-on joystick; the
 * Keeper walks up to a spot searched by hand when the ground is tapped, the
 * easy way searches it, and a common find is a toast (no card); a mound
 * without a Shovel shows a hint above a disabled button; Back returns to
 * the map. Checked through the dev hook.
 */

interface ExploreDebug {
  open: boolean;
  tile: { q: number; r: number; terrain: string } | null;
  progress: { searched: number; total: number } | null;
  spots: { index: number; kind: string; tool: string | null; done: boolean }[];
  keeper: { x: number; z: number };
  near: number | null;
  playing: string | null;
  card: 'rare' | null;
  toast: string | null;
  hint: string | null;
  scene: {
    spots: number;
    done: number;
    glints: number;
    keeper: boolean;
    held: string | null;
    decor: { tufts: number; pebbles: number; flowers: number };
    camera: { x: number; z: number; zoom: number };
    drawCalls: number;
  } | null;
}

type Point = { x: number; y: number };
type ExploreHook = {
  explore?: () => {
    keeper: { x: number; z: number };
    spotOnScreen: (i: number) => Point | null;
    pointOnScreen: (p: { x: number; z: number }) => Point | null;
  };
};

const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const mapState = (page: Page) => hook<{ tiles: number; selected: string | null }>(page, 'map');

/** Where a spot is on screen now (the dev hook projects it), or null off camera. */
function spotOnScreen(page: Page, index: number): Promise<Point | null> {
  return page.evaluate(
    (i) =>
      (window as unknown as { __heartpatch?: ExploreHook }).__heartpatch
        ?.explore?.()
        .spotOnScreen(i) ?? null,
    index,
  );
}

/** Where the Keeper stands on screen now. */
async function keeperOnScreen(page: Page): Promise<Point> {
  const at = await page.evaluate(() => {
    const e = (window as unknown as { __heartpatch?: ExploreHook }).__heartpatch?.explore?.();
    return e ? e.pointOnScreen(e.keeper) : null;
  });
  if (!at) throw new Error('the Keeper is not on screen');
  return at;
}

/** Waits until the Keeper stops walking. */
async function keeperStill(page: Page): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify((await exploreState(page))?.keeper);
        const still = now === last;
        last = now;
        return still;
      },
      { timeout: 20_000, intervals: [400] },
    )
    .toBe(true);
}

/**
 * Walks up to a spot by tapping: the spot itself once it's on screen clear
 * of the controls, else the ground on the way to it (the camera follows).
 */
async function walkTo(page: Page, index: number): Promise<void> {
  const view = page.viewportSize()!;
  const band = { top: 220, bottom: view.height - 220, left: 40, right: view.width - 40 };
  for (let tries = 0; tries < 12; tries++) {
    if ((await exploreState(page))?.near === index) return;
    const spot = await spotOnScreen(page, index);
    const from = await keeperOnScreen(page);
    const to = spot ?? { x: from.x, y: band.top };
    const inside = (p: Point) =>
      p.x >= band.left && p.x <= band.right && p.y >= band.top && p.y <= band.bottom;
    let tap = to;
    if (!inside(to)) {
      // Part way along, kept in the band.
      let k = 1;
      for (
        let i = 0;
        i < 20 && !inside({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
        i++
      ) {
        k *= 0.8;
      }
      tap = {
        x: Math.min(band.right, Math.max(band.left, from.x + (to.x - from.x) * k)),
        y: Math.min(band.bottom, Math.max(band.top, from.y + (to.y - from.y) * k)),
      };
    }
    await realTapAt(page, tap.x, tap.y);
    await keeperStill(page);
  }
  await expect.poll(async () => (await exploreState(page))?.near, slow).toBe(index);
}

test('explores a home tile: walk, search the easy way, a find toast, a missing Shovel', async ({
  browser,
}) => {
  test.setTimeout(240_000); // two scene builds and a few walks; CI renders in software
  const page = await newPlayer(browser, uniqueName('explore'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Seeker Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(469);

  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // The camera starts on the Heart Seed: tap it, then Explore. A busy WebKit
  // runner can miss the first tap while the map settles, so tap again only
  // while nothing is picked (a second tap on the picked Heart Seed opens Home).
  const box = (await page.locator('#game').boundingBox())!;
  const explore = page.getByTestId('tile-explore');
  await expect(async () => {
    if ((await mapState(page))?.selected == null) {
      await realTapAt(page, box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(explore).toBeVisible({ timeout: 5_000 });
  }).toPass(slow);
  await explore.tap();

  await expect.poll(async () => (await exploreState(page))?.scene?.keeper, slow).toBe(true);
  const first = (await exploreState(page))!;
  expect(first.open).toBe(true);
  expect(first.spots.length).toBeGreaterThan(0);
  await slowExpect(page.getByTestId('map-hud')).toBeHidden();
  await expect(page.getByTestId('explore-progress')).toHaveText(
    `0 of ${String(first.spots.length)} found 🔍`,
  );
  // Every unsearched spot glints, the tile grows decor, and the joystick is always there.
  expect(first.scene?.glints).toBe(first.spots.length);
  expect(first.scene?.decor.tufts).toBeGreaterThan(0);
  await expect(page.getByTestId('explore-stick')).toBeVisible();
  // Nothing in front yet: the big button says to find a glint.
  if (first.near === null) await expect(page.getByTestId('explore-action')).toBeDisabled();

  // The performance budget: a settled frame stays under the ceiling.
  await expect
    .poll(() => exploreState(page).then((s) => s?.scene?.drawCalls ?? 0), slow)
    .toBeGreaterThan(0);
  const drawCalls = (await exploreState(page))?.scene?.drawCalls ?? 0;
  test.info().annotations.push({ type: 'drawCalls', description: String(drawCalls) });
  expect(drawCalls).toBeLessThan(DRAW_CALL_CEILING);

  // Walk to a spot searched by hand and search it the easy way. A common find
  // is a toast and the world keeps going; a rare one (a lore page, something
  // to wear) gets the card, so try the next hand spot until a toast shows.
  const action = page.getByTestId('explore-action');
  const sheet = page.getByTestId('explore-sheet');
  const handSpots = first.spots.filter((s) => s.tool === null);
  let searched = 0;
  let toasted = false;
  for (const hands of handSpots.slice(0, 4)) {
    await walkTo(page, hands.index);
    // The camera followed the Keeper.
    const walked = (await exploreState(page))!;
    expect(walked.scene?.camera.z).not.toBe(first.scene?.camera.z);
    await slowExpect(action).toBeEnabled();
    await action.tap();
    // A light overlay, not a card: the chip, the easy way and "Not now".
    await slowExpect(page.getByTestId('explore-play')).toBeVisible();
    await expect(page.getByTestId('explore-chip')).toBeVisible();
    await expect(page.getByTestId('explore-not-now')).toBeVisible();
    await expect(sheet).toBeHidden();
    await page.getByTestId('explore-easy').tap();
    await expect
      .poll(async () => {
        const s = await exploreState(page);
        return s?.toast !== null || s.card !== null;
      }, slow)
      .toBe(true);
    searched += 1;
    const after = (await exploreState(page))!;
    expect(after.spots.find((s) => s.index === hands.index)?.done).toBe(true);
    if (after.card === 'rare') {
      await slowExpect(sheet).toBeVisible();
      await sheet.getByTestId('explore-yay').tap();
      await slowExpect(sheet).toBeHidden();
      continue;
    }
    expect(after.card).toBeNull();
    await expect(sheet).toBeHidden();
    const toast = page.getByTestId('explore-toast');
    await expect(toast).toBeVisible();
    expect(findAvoidedWords((await toast.textContent()) ?? '')).toEqual([]);
    toasted = true;
    break;
  }
  expect(toasted).toBe(true);
  const after = (await exploreState(page))!;
  expect(after.progress?.searched).toBe(searched);
  expect(after.scene?.done).toBe(searched);
  // A searched spot just loses its glint.
  expect(after.scene?.glints).toBe(first.spots.length - searched);
  await expect(page.getByTestId('explore-progress')).toHaveText(
    `${String(searched)} of ${String(first.spots.length)} found 🔍`,
  );

  // A mound needs a Shovel: a hint above a disabled button says how to make one.
  const mound = first.spots.find((s) => s.tool === 'shovel');
  if (mound) {
    await walkTo(page, mound.index);
    await expect.poll(async () => (await exploreState(page))?.hint, slow).toBe('shovel');
    const hint = page.getByTestId('explore-need');
    await slowExpect(hint).toContainText('This mound needs a Shovel!');
    await slowExpect(page.getByTestId('explore-recipe')).toContainText('Timber');
    await expect(action).toBeDisabled();
    await expect(action).toContainText('Dig');
    expect((await exploreState(page))?.card).toBeNull();
    expect((await exploreState(page))?.progress?.searched).toBe(searched);
  }

  // Back to the map, with the explore view put away.
  await page.getByTestId('explore-back').tap();
  await slowExpect(page.getByTestId('map-hud')).toBeVisible();
  expect((await exploreState(page))?.open).toBe(false);
  expect(errors).toEqual([]);
});
