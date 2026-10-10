import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { keeperStill, nearestFirst, walkTo, waypoint } from './explore-walk.js';
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
const DRAW_CALL_CEILING = 26;

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
    buildings: number;
    held: string | null;
    decor: { tufts: number; pebbles: number; flowers: number };
    camera: { x: number; z: number; zoom: number };
    drawCalls: number;
    keeperHeight: number;
    faded: number[];
  } | null;
}

const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const mapState = (page: Page) => hook<{ tiles: number; selected: string | null }>(page, 'map');

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
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(817); // a new 6-seat patch (#318)

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
  // Exploring owns the screen: the "Hi, name! Log out" chip steps aside, and
  // the header fits one row, the tile's name and progress never cut off.
  await expect(page.locator('.auth-chip')).toBeHidden();
  for (const sel of ['.explore-title', '.explore-progress']) {
    const fits = await page
      .locator(sel)
      .evaluate((e) => e.scrollWidth <= e.clientWidth && e.clientWidth > 0);
    expect(fits, `${sel} fits`).toBe(true);
  }
  // The camera frames the Keeper about a sixth of the screen tall
  // (board a): close and cozy, but never so big it hides the spots beside it.
  await expect
    .poll(async () => (await exploreState(page))?.scene?.keeperHeight ?? 0, slow)
    .toBeGreaterThan(0.14);
  expect((await exploreState(page))?.scene?.keeperHeight).toBeLessThan(0.195);
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
  const handSpots = nearestFirst(
    first.spots.filter((s) => s.tool === null),
    first.keeper,
  );
  let searched = 0;
  let toasted = false;
  for (const hands of handSpots.slice(0, 5)) {
    if (!(await walkTo(page, hands.index))) continue;
    // The camera follows the Keeper: it settles looking just ahead of it.
    await expect
      .poll(async () => {
        const s = (await exploreState(page))!;
        const cam = s.scene!.camera;
        return Math.hypot(cam.x - s.keeper.x, cam.z - s.keeper.z);
      }, slow)
      .toBeLessThan(0.25);
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
  const mounds = first.spots.filter((s) => s.tool === 'shovel');
  if (mounds.length > 0) {
    const ids = mounds.map((s) => s.index);
    // Any mound will do: a neighbour's hint can cover the one aimed at.
    let reached = false;
    for (const mound of nearestFirst(mounds, (await exploreState(page))!.keeper).slice(0, 4)) {
      if ((reached = await walkTo(page, mound.index, ids))) break;
    }
    expect(reached, 'walked up to a mound').toBe(true);
    await expect.poll(async () => (await exploreState(page))?.hint, slow).toBe('shovel');
    const hint = page.getByTestId('explore-need');
    await slowExpect(hint).toContainText('This mound needs a Shovel!');
    await slowExpect(page.getByTestId('explore-recipe')).toContainText('Timber');
    await expect(action).toBeDisabled();
    await expect(action).toContainText('Dig');
    expect((await exploreState(page))?.card).toBeNull();
    expect((await exploreState(page))?.progress?.searched).toBe(searched);
  }

  // A tall prop between the camera and the Keeper fades (#291), and the
  // see-through copy stays inside the draw-call budget. Tap-walk to just
  // behind (further from the camera than) a tall spot; a tile whose tall
  // spots can't be reached by taps skips this, saying so.
  const tall = ['tree', 'rock', 'hollow-log', 'pumpkin-row', 'ledge', 'cave', 'reeds'];
  let faded = false;
  const state = (await exploreState(page))!;
  for (const spot of nearestFirst(
    state.spots.filter((s) => tall.includes(s.kind)),
    state.keeper,
  ).slice(0, 3)) {
    const behind = { x: spot.x, z: spot.z + 0.12 };
    for (let tries = 0; tries < 6; tries++) {
      const k = (await exploreState(page))!.keeper;
      if (Math.hypot(k.x - behind.x, k.z - behind.z) < 0.04) break;
      const tap = await waypoint(page, behind);
      if (!tap) break;
      await realTapAt(page, tap.x, tap.y);
      await keeperStill(page);
    }
    if (((await exploreState(page))?.scene?.faded.length ?? 0) > 0) {
      faded = true;
      break;
    }
  }
  if (faded) {
    await page.waitForTimeout(500);
    const now = (await exploreState(page))!.scene!;
    test.info().annotations.push({ type: 'drawCallsFaded', description: String(now.drawCalls) });
    expect(now.drawCalls).toBeLessThan(DRAW_CALL_CEILING);
  } else {
    test.info().annotations.push({
      type: 'skipped',
      description: 'fade: no tall spot on this tile could be reached by taps from behind',
    });
  }

  // Back to the map, with the explore view put away.
  await page.getByTestId('explore-back').tap();
  await slowExpect(page.getByTestId('map-hud')).toBeVisible();
  expect((await exploreState(page))?.open).toBe(false);
  expect(errors).toEqual([]);
});

test('shows the buildings on the tile it explores (#347)', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('builds'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Den Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;

  const box = (await page.locator('#game').boundingBox())!;
  const explore = page.getByTestId('tile-explore');
  const openExplore = async () => {
    await expect(async () => {
      if ((await mapState(page))?.selected == null) {
        await realTapAt(page, box.x + box.width / 2, box.y + box.height / 2);
      }
      await expect(explore).toBeVisible({ timeout: 5_000 });
    }).toPass(slow);
    await explore.tap();
    await expect.poll(async () => (await exploreState(page))?.scene?.keeper, slow).toBe(true);
  };

  // The Heart Seed's tile has nothing built on it yet.
  await openExplore();
  const first = (await exploreState(page))!;
  expect(first.scene?.buildings).toBe(0);
  const at = first.tile!;
  await page.getByTestId('explore-back').tap();
  await slowExpect(page.getByTestId('map-hud')).toBeVisible();

  // An Ember Den on one of its ring spots, then explore it again.
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 5, stone: 3 },
  });
  expect(granted.status).toBe(201);
  const built = await api(page, 'POST', `/maps/${mapId}/buildings`, {
    buildingId: 'ember-den',
    q: at.q,
    r: at.r,
    spot: 1,
  });
  expect(built.status).toBe(201);
  // The map hears about the new den, then Explore opens on the tile again.
  await openExplore();
  await expect.poll(async () => (await exploreState(page))?.scene?.buildings ?? 0, slow).toBe(1);
});
