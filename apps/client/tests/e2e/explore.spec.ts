import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { keeperStill, nearestFirst, walkTo, waypoint } from './explore-walk.js';
import { realTapAt } from './touch.js';

/** Server replies and scene builds can be slow on a busy CI runner (software rendering). */
const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };
/** WebKit's page error for an in-flight API fetch a navigation aborts (as in hollow.spec.ts). */
const ABORTED_FETCH = /\/api\/v1\/\S* due to access control checks\.?$/;

/**
 * The performance budget (CLAUDE.md rule 8): a settled explore frame draws
 * under this many calls. A new player's meadow is on the land kit (#335 art
 * reset): measured at 37 on the iPhone and iPad viewports on the high tier
 * (the sky, the ground, grass and three kinds of flower, pebbles, two kinds of
 * bush, three of tree, far trees, rocks, logs, mushrooms, lanterns and their
 * glass, butterflies and pollen, the spot props, glints, the Keeper's batches,
 * post-processing) and 31 on low (no motes). Each kind is one thin-instanced
 * draw however many grow; the headroom is for a busier tile (more prop kinds,
 * buildings, the tool in hand).
 */
const DRAW_CALL_CEILING = 46;
/** The land kit's triangles on a settled meadow frame (#335): 278k–308k on high, with headroom for a busier tile. */
const TRIANGLE_CEILING = 420_000;

/**
 * Explore builds without GPU churn (#501 D1): the kit's shapes are merged on
 * the CPU, so a build makes only the meshes it keeps (42 on a meadow, 48 on
 * a lake; it made 330–400 when every part was a mesh of its own) …
 */
const BUILD_MESH_CEILING = 60;
/**
 * … and they come from the page's cache, so going back to a tile makes only
 * the tile's own WebGL buffers (instances, ground, the stage's targets: about
 * 110; the first build also uploads the kit, and each build made about 2.4k).
 */
const REBUILD_BUFFER_CEILING = 200;
/**
 * A find makes next to no WebGL buffers (#501 H): the toast, card and flying
 * finds are page elements and the cheer moves the Keeper's batches in place.
 * Headroom for a stage target the browser remakes.
 */
const FIND_BUFFER_CEILING = 20;

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
  walkGoal: { x: number; z: number } | null;
  near: number | null;
  playing: string | null;
  card: 'rare' | null;
  toast: string | null;
  hint: string | null;
  batchUploads: number;
  tierChanges: number;
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
    sky: { clouds: number; stars: boolean; moon: boolean; underwater: boolean };
    keeperHeight: number;
    faded: number[];
    fadedCover: number[];
    triangles: number;
    created: { meshes: number; materials: number; textures: number; geometries: number };
    gl: { buffers: number; programs: number } | null;
    warm: boolean;
    land: { tier: string } | null;
    water: { layers: Record<string, number> } | null;
    ambient: { mode: string; slow: boolean; hitches: number };
  } | null;
}

const exploreState = (page: Page) => hook<ExploreDebug>(page, 'explore');
const frameCap = (page: Page) => hook<{ fps: number }>(page, 'frameCap');

/** Frames drawn so far and the page's clock, to read a drawn frame rate between two readings. */
const frameClock = (page: Page) =>
  page.evaluate(() => ({
    draws: (window as { __heartpatch?: { draws(): number } }).__heartpatch?.draws() ?? 0,
    at: performance.now(),
  }));

/** Explore draws at most 30 frames a second (#501, owner Oct 18), with a frame of slack for the clock. */
const EXPLORE_MAX_FPS = 31;
const mapState = (page: Page) =>
  hook<{ tiles: number; selected: string | null; buildings: number }>(page, 'map');
/** Test scenes built since the page loaded (#501 G: a map↔explore switch builds none). */
const testScenes = (page: Page) => hook<number>(page, 'testScenes');
const quality = (page: Page) => hook<{ tier: string; renderScale: number }>(page, 'quality');
const hitchesExpected = (page: Page) => hook<number>(page, 'hitchesExpected');

/** How far the lake test swims (tile-local; the tile is 2 across). */
const LAKE_SWIM = 0.15;
/** Near enough the tapped point to have arrived: a tap lands within a pixel or two of it. */
const ARRIVED = 0.02;

/**
 * A point `reach` from the Keeper that a tap lands on the ground at and that
 * the Keeper swims straight to: nothing it slides round on the way, no spot
 * near enough to take the tap, well inside the tile. Its screen point, and where it is. Null if no direction
 * round the Keeper works.
 */
function clearTap(
  page: Page,
  reach: number,
): Promise<{ x: number; y: number; to: { x: number; z: number } } | null> {
  return page.evaluate((reach) => {
    type Hook = {
      explore?: () => {
        keeper: { x: number; z: number };
        blockers: readonly { x: number; z: number; r: number }[];
        spots: readonly { x: number; z: number; done: boolean }[];
        tapPick: number;
        pointOnScreen: (p: { x: number; z: number }) => { x: number; y: number } | null;
      };
    };
    const e = (window as unknown as { __heartpatch?: Hook }).__heartpatch?.explore?.();
    if (!e) return null;
    const ground = document.querySelector('[data-testid="explore-ground"]');
    const k = e.keeper;
    /** Distance from `c` to the segment from the Keeper to `to`. */
    const gap = (c: { x: number; z: number }, to: { x: number; z: number }) => {
      const dx = to.x - k.x;
      const dz = to.z - k.z;
      const t = Math.max(
        0,
        Math.min(1, ((c.x - k.x) * dx + (c.z - k.z) * dz) / (dx * dx + dz * dz)),
      );
      return Math.hypot(k.x + dx * t - c.x, k.z + dz * t - c.z);
    };
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      const to = { x: k.x + Math.cos(a) * reach, z: k.z + Math.sin(a) * reach };
      if (Math.hypot(to.x, to.z) > 0.6) continue; // well clear of the tile's edge
      if (e.blockers.some((c) => gap(c, to) < c.r + 0.02)) continue;
      // Not so near a spot that the tap picks it (the Keeper would stop beside it).
      if (e.spots.some((p) => !p.done && Math.hypot(p.x - to.x, p.z - to.z) < e.tapPick + 0.02)) {
        continue;
      }
      const at = e.pointOnScreen(to);
      if (at && document.elementFromPoint(at.x, at.y) === ground) return { ...at, to };
    }
    return null;
  }, reach);
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
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(817); // a new 6-seat patch (#318)

  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // The camera starts on the Heart Seed: tap it, then Explore. The tap is
  // dispatched in the page (`tapCanvas`): a press Playwright sends during a
  // slow software frame isn't handled until the frame ends, so its lift came
  // 500–700 ms later and the map took it for a long press (TAP_MAX_MS). A busy
  // WebKit runner can still miss the first tap while the map settles, so tap
  // again only while nothing is picked (a second tap on the picked Heart Seed
  // opens Home).
  const box = (await page.locator('#game').boundingBox())!;
  const explore = page.getByTestId('tile-explore');
  await expect(async () => {
    if ((await mapState(page))?.selected == null) {
      await tapCanvas(page, box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(explore).toBeVisible({ timeout: 5_000 });
  }).toPass(slow);
  // The map draws on demand, uncapped (#501).
  expect(await frameCap(page)).toBeNull();
  const testScenesOnMap = await testScenes(page);
  expect(testScenesOnMap).not.toBeNull();
  await explore.tap();

  await expect.poll(async () => (await exploreState(page))?.scene?.keeper, slow).toBe(true);
  const first = (await exploreState(page))!;
  expect(first.open).toBe(true);
  // The map handed the screen straight to explore: no test scene built and thrown away (#501 G).
  expect(await testScenes(page)).toBe(testScenesOnMap);
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
  // On arrival the fade is worked out against the settled shot (#335), not the
  // map's view: anything faded really covers the Keeper on screen.
  for (const cover of (await exploreState(page))?.scene?.fadedCover ?? []) {
    expect(cover).toBeGreaterThanOrEqual(0.12);
  }
  // The sky follows the patch's clock (#335): e2e pins late morning, so it's day with clouds.
  expect(first.scene?.sky).toEqual({ clouds: 4, stars: false, moon: false, underwater: false });
  // Every unsearched spot glints, the tile grows decor, and the joystick is always there.
  expect(first.scene?.glints).toBe(first.spots.length);
  expect(first.scene?.decor.tufts).toBeGreaterThan(0);
  await expect(page.getByTestId('explore-stick')).toBeVisible();
  // The ?fps=1 badge (on in dev builds) sits clear of the controls (#501):
  // the owner couldn't read it behind the joystick and the big button.
  for (const badge of ['dev-stats', 'dev-stats-counts', 'dev-stats-page']) {
    const b = await page.getByTestId(badge).boundingBox();
    expect(b, badge).not.toBeNull();
    for (const control of [
      page.getByTestId('explore-stick'),
      page.getByTestId('explore-action'),
      page.locator('.explore-top'),
    ]) {
      const c = (await control.boundingBox())!;
      const overlaps =
        b!.x < c.x + c.width &&
        c.x < b!.x + b!.width &&
        b!.y < c.y + c.height &&
        c.y < b!.y + b!.height;
      expect(overlaps, `${badge} clear of ${String(control)}`).toBe(false);
    }
  }
  // Nothing in front yet: the big button says to find a glint.
  if (first.near === null) await expect(page.getByTestId('explore-action')).toBeDisabled();

  // The performance budget: a settled frame stays under the ceiling.
  await expect
    .poll(() => exploreState(page).then((s) => s?.scene?.drawCalls ?? 0), slow)
    .toBeGreaterThan(0);
  const drawCalls = (await exploreState(page))?.scene?.drawCalls ?? 0;
  test.info().annotations.push({ type: 'drawCalls', description: String(drawCalls) });
  expect(drawCalls).toBeLessThan(DRAW_CALL_CEILING);
  // The meadow is on the land kit (#335), never silently back on the old tile,
  // and its triangles stay in budget (308k on an iPad at high; 175–199k on low).
  const settled = (await exploreState(page))?.scene;
  expect(settled?.land).not.toBeNull();
  test.info().annotations.push({ type: 'triangles', description: String(settled?.triangles) });
  expect(settled?.triangles ?? 0).toBeLessThan(TRIANGLE_CEILING);
  const builtOnArrival = settled?.created;
  const tierChangesOnArrival = (await exploreState(page))?.tierChanges;
  expect(builtOnArrival?.meshes ?? 0).toBeGreaterThan(0);
  expect(builtOnArrival?.meshes ?? 0).toBeLessThanOrEqual(BUILD_MESH_CEILING);
  // Explore runs cool (#501): its stage is capped at 30 frames a second.
  expect(await frameCap(page)).toMatchObject({ fps: 30 });

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
  let guardSkipped: string | null = 'the first hand spot was already in reach';
  let toasted = false;
  for (const hands of handSpots.slice(0, 5)) {
    const walkStart = await frameClock(page);
    if (!(await walkTo(page, hands.index))) continue;
    const walkEnd = await frameClock(page);
    // The camera follows the Keeper: it settles looking just ahead of it.
    await expect
      .poll(async () => {
        const s = (await exploreState(page))!;
        const cam = s.scene!.camera;
        return Math.hypot(cam.x - s.keeper.x, cam.z - s.keeper.z);
      }, slow)
      .toBeLessThan(0.25);
    const walked = (await exploreState(page))!;
    const moved = walked.keeper.x !== first.keeper.x || walked.keeper.z !== first.keeper.z;
    // A software renderer's governor may change tier while exploring, and the
    // walk's first step applies it (the team's detail level rebuilds): that's
    // a rebuild on purpose, so only a walk on one tier is judged. A tier
    // probe that failed goes down and straight back: the tier ends where it
    // started, but the Keeper rebuilt twice (#501 G), so that's a change too.
    const sameTier =
      walked.scene?.land?.tier === settled?.land?.tier &&
      walked.tierChanges === tierChangesOnArrival;
    if (searched === 0 && moved && !sameTier) guardSkipped = 'the tier changed during the walk';
    if (searched === 0 && moved && sameTier) {
      // The frame-rate guard (#501): walking draws every frame, so it must
      // only move what's built. A mesh, material, texture or geometry made
      // per step (a rebuilt fade, glints or ground) would count up here, as
      // a frame over the draw-call budget would show.
      expect(walked.scene?.created).toEqual(builtOnArrival);
      expect(walked.scene?.drawCalls ?? 0).toBeLessThan(DRAW_CALL_CEILING);
      // And at no more than 30 drawn frames a second (#501). A software
      // renderer is far below that anyway; the cap itself is unit-tested
      // (stage.test.ts), this catches a walk that bypasses it.
      // Only over a second or more: a spot already in reach makes a window of
      // a few ms, where one frame would read as 100+ fps.
      const walkMs = walkEnd.at - walkStart.at;
      const walkFps = ((walkEnd.draws - walkStart.draws) * 1000) / walkMs;
      test.info().annotations.push({
        type: 'walkFps',
        description: `${walkFps.toFixed(1)} over ${walkMs.toFixed(0)} ms`,
      });
      if (walkMs >= 1000) expect(walkFps).toBeLessThanOrEqual(EXPLORE_MAX_FPS);
      guardSkipped = null;
    }
    await slowExpect(action).toBeEnabled();
    await action.tap();
    // A light overlay, not a card: the chip, the easy way and "Not now".
    await slowExpect(page.getByTestId('explore-play')).toBeVisible();
    await expect(page.getByTestId('explore-chip')).toBeVisible();
    await expect(page.getByTestId('explore-not-now')).toBeVisible();
    await expect(sheet).toBeHidden();
    // Across the find (#501 G): the Keeper's cheer rewrites its buffers in
    // place, and the governor takes the burst of work as a hitch, not a slow GPU.
    const beforeFind = {
      uploads: (await exploreState(page))!.batchUploads,
      tierChanges: (await exploreState(page))!.tierChanges,
      quality: await quality(page),
      hitches: await hitchesExpected(page),
    };
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
    // Past the cheer and the governor's next windows (it reads frames in 500 ms windows).
    await page.waitForTimeout(2000);
    const after = (await exploreState(page))!;
    expect(after.spots.find((s) => s.index === hands.index)?.done).toBe(true);
    // A tier change meanwhile rebuilds the Keeper on purpose (CI's WebKit governor probes tiers).
    if (after.tierChanges === beforeFind.tierChanges) {
      expect(after.batchUploads, 'Keeper buffers made by the find').toBe(beforeFind.uploads);
    } else {
      test.info().annotations.push({
        type: 'skipped',
        description: 'Keeper buffers across a find (#501 G): the tier changed meanwhile',
      });
    }
    // The find told the governor to expect a hitch, as it starts and as the
    // reply lands, so it ignores the frames round it (#501 G). That it then
    // changes nothing is the governor's unit tests' to prove: here a
    // software renderer's governor raises and probes tiers on its own
    // timers, find or no find, so the tier before and after is only noted.
    expect(await hitchesExpected(page)).toBeGreaterThanOrEqual((beforeFind.hitches ?? 0) + 2);
    const afterFind = await quality(page);
    test.info().annotations.push({
      type: 'qualityAcrossFind',
      description: `${String(beforeFind.quality?.tier)} ${String(beforeFind.quality?.renderScale)} → ${String(afterFind?.tier)} ${String(afterFind?.renderScale)}`,
    });
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
  if (guardSkipped !== null) {
    test
      .info()
      .annotations.push({ type: 'skipped', description: `walk guard (#501): ${guardSkipped}` });
  }
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
    // Only a spot that really covers the Keeper on screen fades (#335), never
    // one standing beside it: at least EXPLORE_FADE.cover (0.12) of the Keeper.
    for (const cover of now.fadedCover) expect(cover).toBeGreaterThanOrEqual(0.12);
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
  // The map's stage is back on demand, uncapped (#501).
  await expect.poll(() => frameCap(page), slow).toBeNull();
  // Explore's scene stayed up until the map's was ready: still no test scene (#501 G).
  expect(await testScenes(page)).toBe(testScenesOnMap);
  expect(errors).toEqual([]);
});

test('shows the buildings on the tile it explores (#347)', async ({ browser }) => {
  test.setTimeout(360_000); // two scene builds and a walk to a mound; CI renders in software
  const page = await newPlayer(browser, uniqueName('builds'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // One tier throughout (dev `?tier=`, governor off; low, the quickest to
  // render in software), so a find below is judged on what it compiles, not
  // on a software renderer's tier change.
  await page.goto('/?tier=low');
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Den Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  // The whole patch is on the map before the first tap, as in the test above:
  // on a busy runner an early tap can land before the camera rests on the Heart Seed.
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(817);
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;

  const box = (await page.locator('#game').boundingBox())!;
  const explore = page.getByTestId('tile-explore');
  const openExplore = async () => {
    await expect(async () => {
      if ((await mapState(page))?.selected == null) {
        await tapCanvas(page, box.x + box.width / 2, box.y + box.height / 2);
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
  expect(first.scene?.created.meshes ?? 0).toBeLessThanOrEqual(BUILD_MESH_CEILING);
  test.info().annotations.push({
    type: 'buffers (first build)',
    description: String(first.scene?.gl?.buffers),
  });
  const at = first.tile!;
  await page.getByTestId('explore-back').tap();
  await slowExpect(page.getByTestId('map-hud')).toBeVisible();

  // An Ember Den on one of its ring spots, then explore it again, with a Shovel to hold.
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 5, stone: 3, shovel: 1 },
  });
  expect(granted.status).toBe(201);
  const built = await api(page, 'POST', `/maps/${mapId}/buildings`, {
    buildingId: 'ember-den',
    q: at.q,
    r: at.r,
    spot: 1,
  });
  expect(built.status).toBe(201);
  // The map hears about the new den (its WS event), then Explore opens on the tile again.
  await expect.poll(async () => (await mapState(page))?.buildings, slow).toBe(1);
  await openExplore();
  const again = (await exploreState(page))!.scene!;
  expect(again.buildings).toBe(1);
  // The second build reuses the kit (#501 D1): no throwaway meshes, and only the tile's own buffers.
  expect(again.created.meshes).toBeLessThanOrEqual(BUILD_MESH_CEILING);
  test
    .info()
    .annotations.push({ type: 'buffers (rebuild)', description: String(again.gl?.buffers) });
  expect(again.gl).not.toBeNull();
  expect(again.gl?.buffers ?? Infinity).toBeLessThanOrEqual(REBUILD_BUFFER_CEILING);

  try {
    // A find with the Shovel: up to a mound, the Keeper takes the Shovel out,
    // digs it the easy way, then the toast and its cheer. Every program those
    // draw with was compiled while the scene loaded (#501 D1): one compiled
    // mid-find is a 50–300 ms stall on a phone.
    const mounds = (await exploreState(page))!.spots.filter((s) => s.tool === 'shovel');
    if (mounds.length > 0) {
      await expect.poll(async () => (await exploreState(page))?.scene?.warm, slow).toBe(true);
      const warmed = (await exploreState(page))!.scene!;
      const ids = mounds.map((s) => s.index);
      let reached = false;
      for (const mound of nearestFirst(mounds, (await exploreState(page))!.keeper).slice(0, 4)) {
        if ((reached = await walkTo(page, mound.index, ids))) break;
      }
      expect(reached, 'walked up to a mound').toBe(true);
      await expect.poll(async () => (await exploreState(page))?.scene?.held, slow).toBe('shovel');
      await slowExpect(page.getByTestId('explore-action')).toBeEnabled();
      await page.getByTestId('explore-action').tap();
      const play = page.getByTestId('explore-play');
      await slowExpect(play).toBeVisible();
      // A scoop a tap, until it's dug.
      for (let i = 0; i < 12 && (await play.isVisible()); i++) {
        await page.getByTestId('explore-easy').tap();
      }
      // Found (a toast or a card), then a moment for its cheer.
      await expect
        .poll(async () => (await exploreState(page))?.scene?.done, slow)
        .toBe(warmed.done + 1);
      await page.waitForTimeout(2_000);
      const found = (await exploreState(page))!.scene!;
      test.info().annotations.push({
        type: 'programs in a find',
        description: String((found.gl?.programs ?? 0) - (warmed.gl?.programs ?? 0)),
      });
      expect(found.gl?.programs).toBe(warmed.gl?.programs);
    } else {
      test.info().annotations.push({
        type: 'skipped',
        description: 'programs in a find (#501): no mound on this tile',
      });
    }
    expect(errors).toEqual([]);
  } finally {
    // Pinned, its ambient life never stops for a slow renderer: close it, so it
    // doesn't keep drawing under the next test.
    await page.context().close();
  }
});

test('a tap on the lakebed swims the Keeper there, and a find leaves the lake alive (#510, #501 H)', async ({
  browser,
}) => {
  test.setTimeout(420_000); // one scene build on medium, a swim and a find; CI renders in software
  const page = await newPlayer(browser, uniqueName('swim'));
  const errors: string[] = [];
  // Only an API fetch the lobby's navigation below aborts is let through (on
  // CI: "…/api/v1/coins due to access control checks."), and only while it
  // loads; every other page error stays fatal.
  let reloading = false;
  page.on('pageerror', (err) => {
    if (reloading && ABORTED_FETCH.test(err.message)) return;
    errors.push(err.message);
  });
  // Medium, pinned (dev `?tier=`, governor off): the lake's fish and bubbles
  // swim there (low draws no ambient life), and the tier can't move under the
  // find. Pinned, the scene's judge never runs (a software renderer would
  // always be "slow"), so whether a find trips it is the unit tests' to prove
  // (ambient-layout.test.ts); here the find must tell the judge, twice.
  reloading = true;
  await page.goto('/?tier=medium');
  // A new patch has no lake at home: explore its Heart Seed tile as one, so
  // the client builds the underwater scene for it (only the look changes),
  // with bubble springs and reed beds for its spots, searched with the Snorkel.
  await page.route('**/maps/*/explore?*', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as {
      terrain: string;
      spots: { kind: string; tool: string | null }[];
    };
    body.terrain = 'lake';
    body.spots.forEach((s, i) => {
      s.kind = i % 2 === 0 ? 'pond' : 'reeds';
      s.tool = 'net';
    });
    await route.fulfill({ response: res, json: body });
  });
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Puddle Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  reloading = false;
  // Every tool, so the server's own spot (whatever it needs) can be searched.
  const mapId = (await hook<{ id: string }>(page, 'map'))!.id;
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { shovel: 1, net: 1, rope: 1, lantern: 1 },
  });
  expect(granted.status).toBe(201);
  const box = (await page.locator('#game').boundingBox())!;
  const explore = page.getByTestId('tile-explore');
  await expect(async () => {
    if ((await mapState(page))?.selected == null) {
      await tapCanvas(page, box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(explore).toBeVisible({ timeout: 5_000 });
  }).toPass(slow);
  await explore.tap();

  try {
    await expect.poll(async () => (await exploreState(page))?.scene?.keeper, slow).toBe(true);
    expect((await exploreState(page))?.scene?.sky.underwater).toBe(true);
    // A lake builds without throwaway meshes too (#501 D1).
    expect((await exploreState(page))?.scene?.created.meshes ?? 0).toBeLessThanOrEqual(
      BUILD_MESH_CEILING,
    );
    // Taps once it has loaded, the programs it shows later compiled too (#501 D1).
    await expect.poll(async () => (await exploreState(page))?.scene?.warm, slow).toBe(true);
    await keeperStill(page);
    const from = (await exploreState(page))!.keeper;
    // Somewhere on the lakebed a little way off with a clear way there (no
    // spot to slide round or stop at), so the swim falls short only if the
    // tap is lost (#546): the Keeper must arrive, not just set off.
    const clear = await clearTap(page, LAKE_SWIM);
    expect(clear, 'a tappable point on the lakebed with a clear way there').not.toBeNull();
    await realTapAt(page, clear!.x, clear!.y);
    // CI's software renderer can swim this few frames a second: it was still
    // on its way (0.019) when 30 s ran out on the iPad, so wait longer here.
    await expect
      .poll(
        async () => {
          const k = (await exploreState(page))!.keeper;
          return Math.hypot(k.x - clear!.to.x, k.z - clear!.to.z);
        },
        { timeout: 90_000 },
      )
      .toBeLessThan(ARRIVED);
    await keeperStill(page);
    const swum = (await exploreState(page))!;
    expect(Math.hypot(swum.keeper.x - from.x, swum.keeper.z - from.z)).toBeGreaterThan(
      LAKE_SWIM - ARRIVED,
    );
    expect(swum.walkGoal).toBeNull();

    // A find on the lake (#501 H, the owner's "glint, tap, celebrate, frozen"):
    // up to a bubble spring or a reed bed, the easy way, then the toast or
    // card and the cheer. Nothing compiles or uploads mid-find, and the
    // water's life keeps going after it.
    const live = (await exploreState(page))!.scene!;
    expect(live.ambient).toMatchObject({ mode: 'live', slow: false });
    expect(live.water?.layers['fish'] ?? 0).toBeGreaterThan(0);
    expect(live.water?.layers['bubbles'] ?? 0).toBeGreaterThan(0);
    const spots = (await exploreState(page))!.spots.filter((s) => !s.done);
    const ids = spots.map((s) => s.index);
    let reached = false;
    for (const spot of nearestFirst(spots, (await exploreState(page))!.keeper).slice(0, 4)) {
      if ((reached = await walkTo(page, spot.index, ids))) break;
    }
    expect(reached, 'swam up to a spring or a reed bed').toBe(true);
    await slowExpect(page.getByTestId('explore-action')).toBeEnabled();
    const before = (await exploreState(page))!.scene!;
    const hitches = (await hitchesExpected(page)) ?? 0;
    await page.getByTestId('explore-action').tap();
    const play = page.getByTestId('explore-play');
    await slowExpect(play).toBeVisible();
    for (let i = 0; i < 12 && (await play.isVisible()); i++) {
      await page.getByTestId('explore-easy').tap();
    }
    await expect
      .poll(async () => (await exploreState(page))?.scene?.done, slow)
      .toBe(before.done + 1);
    await page.waitForTimeout(2_000);
    const found = (await exploreState(page))!.scene!;
    test.info().annotations.push({
      type: 'lake find: programs, buffers',
      description: `${String((found.gl?.programs ?? 0) - (before.gl?.programs ?? 0))}, ${String((found.gl?.buffers ?? 0) - (before.gl?.buffers ?? 0))}`,
    });
    expect(found.gl?.programs).toBe(before.gl?.programs);
    expect((found.gl?.buffers ?? 0) - (before.gl?.buffers ?? 0)).toBeLessThanOrEqual(
      FIND_BUFFER_CEILING,
    );
    // The find told the governor (#501 G) and the scene's judge (#501 H), at
    // its start and as it landed, and the water still swims.
    expect(await hitchesExpected(page)).toBeGreaterThanOrEqual(hitches + 2);
    expect(found.ambient.hitches).toBeGreaterThanOrEqual(before.ambient.hitches + 2);
    expect(found.ambient).toMatchObject({ mode: 'live', slow: false });
    expect(found.water?.layers['fish'] ?? 0).toBeGreaterThan(0);
    expect(found.water?.layers['bubbles'] ?? 0).toBeGreaterThan(0);
    const sheet = page.getByTestId('explore-sheet');
    if (await sheet.isVisible()) await sheet.getByTestId('explore-yay').tap();
    expect(errors).toEqual([]);
    await page.getByTestId('explore-back').tap();
  } finally {
    // Pinned, its ambient life never stops for a slow renderer: close it, so it
    // doesn't keep drawing under the next test.
    await page.context().close();
  }
});
