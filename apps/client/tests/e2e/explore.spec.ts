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
 * under this many calls. Measured at 15 on the iPhone and iPad viewports
 * (#291, a new player's meadow: tile, island, spot props, three decor kinds,
 * glints, the Keeper's batches, post-processing); the headroom is for a busier
 * tile (more prop kinds, buildings, a full team, the tool in hand).
 */
const DRAW_CALL_CEILING = 40;

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
    pointOnScreen: (p: { x: number; z: number }) => Point | null;
  };
};

const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const mapState = (page: Page) => hook<{ tiles: number; selected: string | null }>(page, 'map');

/**
 * A point on the ground to tap on the way from the Keeper to a tile-local
 * spot: the spot itself if a tap there reaches the ground, else part way
 * there, else a little to one side (the controls and the hint cover parts
 * of the screen). Null when nothing on the way can be tapped.
 */
function waypoint(page: Page, to: { x: number; z: number }): Promise<Point | null> {
  return page.evaluate((spot) => {
    const e = (window as unknown as { __heartpatch?: ExploreHook }).__heartpatch?.explore?.();
    if (!e) return null;
    const ground = document.querySelector('[data-testid="explore-ground"]');
    const k = e.keeper;
    const dx = spot.x - k.x;
    const dz = spot.z - k.z;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      for (const f of [1, 0.75, 0.5, 0.35, 0.2]) {
        const p = { x: k.x + (dx * c - dz * s) * f, z: k.z + (dx * s + dz * c) * f };
        const at = e.pointOnScreen(p);
        if (at && document.elementFromPoint(at.x, at.y) === ground) return at;
      }
    }
    return null;
  }, to);
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
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
}

/**
 * Walks up to a spot by tapping: the spot itself once a tap there reaches
 * the ground, else the ground on the way to it (the camera follows). Stops
 * early once any spot in `orAny` is in front.
 */
async function walkTo(page: Page, index: number, orAny: readonly number[] = []): Promise<void> {
  const done = (near: number | null | undefined) =>
    near === index || (near != null && orAny.includes(near));
  for (let tries = 0; tries < 12; tries++) {
    const state = (await exploreState(page))!;
    if (done(state.near)) return;
    const spot = state.spots.find((s) => s.index === index)!;
    const tap = await waypoint(page, spot);
    if (!tap) throw new Error(`no ground to tap towards spot ${String(index)}`);
    await realTapAt(page, tap.x, tap.y);
    await keeperStill(page);
  }
  await expect.poll(async () => done((await exploreState(page))?.near), slow).toBe(true);
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
    // The toast is short-lived: read it and the hook in the same breath.
    type Seen = { toast: string | null; card: string | null; shown: boolean };
    let seen: Seen = { toast: null, card: null, shown: false };
    await expect
      .poll(async () => {
        seen = await page.evaluate(() => {
          const e = (
            window as unknown as {
              __heartpatch?: { explore?: () => { toast: string | null; card: string | null } };
            }
          ).__heartpatch?.explore?.();
          const box = document.querySelector<HTMLElement>('[data-testid="explore-toast"]');
          return {
            toast: e?.toast ?? null,
            card: e?.card ?? null,
            shown: box !== null && !box.hidden && box.textContent !== '',
          };
        });
        return seen.toast !== null || seen.card !== null;
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
    expect(seen.shown).toBe(true);
    expect(findAvoidedWords(seen.toast ?? '')).toEqual([]);
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
  const mounds = first.spots.filter((s) => s.tool === 'shovel').map((s) => s.index);
  const mound = mounds[0];
  if (mound !== undefined) {
    // Any mound will do: a neighbour's hint can cover the one aimed at.
    await walkTo(page, mound, mounds);
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
