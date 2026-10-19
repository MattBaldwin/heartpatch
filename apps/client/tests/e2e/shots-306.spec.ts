import { expect, test, type Page } from '@playwright/test';
import { api, draws, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTapAt } from './touch.js';

/*
 * PROTOTYPE (#306 plan): the mockup captures. Not a CI spec: run with
 * `playwright test --config shots-306.config.ts` against the dev servers.
 * Every capture is the real map or explore view with the Hollowed preview
 * flag on, at the pinned high tier, dev HUD hidden (`?fps=0`).
 */

const OUT = process.env['HP_SHOTS_DIR'] ?? '/tmp/shots';
const slow = { timeout: 120_000 };
/** `HP_SHOTS_FROM=restored` skips the grey and explore captures (v3 reshoots the restored ones only). */
const FROM_RESTORED = process.env['HP_SHOTS_FROM'] === 'restored';

type Cluster = { id: string; centre: { q: number; r: number }; tiles: { q: number; r: number }[] };
type Hollowed = {
  clusters(): Cluster[];
  look(which: 'near' | 'far' | 'both', distance: number): void;
  tileAt(q: number, r: number): { x: number; y: number; width: number; height: number } | null;
  show(show: string | null): void;
  explore(q: number, r: number): void;
  sheets(): string | null;
  closeSheets(): void;
};

const call = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => {
      const h = (window as unknown as { __heartpatch?: { hollowed?: () => Hollowed } }).__heartpatch?.hollowed?.();
      if (!h) return null;
      return (h as unknown as Record<string, (...x: unknown[]) => unknown>)[f as string]?.(...(a as unknown[])) as T;
    },
    [fn, args] as const,
  );

const mapState = (page: Page) => hook<{ id: string; tiles: number; selected: string | null; drawCalls: number; activeTriangles: number }>(page, 'map');
const exploreState = (page: Page) =>
  hook<{
    open: boolean;
    tile: { q: number; r: number; terrain: string } | null;
    keeper: { x: number; z: number };
    scene: { keeper: boolean; drawCalls: number; triangles: number; spots: number; glints: number } | null;
    hollowed: { discs: number; sparks: number; echoes: number } | null;
  }>(page, 'explore');

async function settle(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

async function shot(page: Page, name: string, notes: Record<string, unknown> = {}): Promise<void> {
  const project = test.info().project.name;
  await page.screenshot({ path: `${OUT}/${project}/${name}.png` });
  test.info().annotations.push({ type: 'shot', description: JSON.stringify({ project, name, ...notes }) });
  console.log(`SHOT ${project} ${name} ${JSON.stringify(notes)}`);
}

async function waitMap(page: Page): Promise<void> {
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(817);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', slow);
  await settle(page, 1500);
}

/** Reloads with a query. The app resumes the last patch by itself (the lobby only shows when it can't). */
async function reopen(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  const lobby = page.getByTestId('lobby');
  const visit = lobby.getByRole('button', { name: 'Visit patch' }).first();
  await expect
    .poll(async () => (await visit.isVisible()) || ((await mapState(page))?.tiles ?? 0) > 0, slow)
    .toBe(true);
  if (await visit.isVisible()) {
    await visit.tap();
    await expect(lobby).toBeHidden(slow);
  }
  await waitMap(page);
  // Sprout's one-time tray hint would sit in every capture.
  // On a short phone it can sit under an opening card and never settle: a quick, forced tap, or skip it.
  const gotIt = page.getByRole('button', { name: 'Got it!' });
  if (await gotIt.isVisible()) await gotIt.tap({ timeout: 5_000, force: true }).catch(() => {});
  await settle(page, 500);
}

/** Sprout's tray hint, if it is still up (on the SE it can outlive the first forced tap). */
async function dismissHint(page: Page): Promise<void> {
  const gotIt = page.getByRole('button', { name: 'Got it!' });
  for (let i = 0; i < 5 && (await gotIt.isVisible()); i++) {
    await gotIt.tap({ timeout: 2_000, force: true }).catch(() => {});
    await settle(page, 400);
  }
}

/** Pans the map (instantly) and waits for a drawn frame, so tile rects are fresh. */
async function look(page: Page, which: 'near' | 'far' | 'both' | 'key', distance: number): Promise<void> {
  const before = await draws(page);
  await call(page, 'look', which, distance);
  await expect.poll(() => draws(page), slow).toBeGreaterThan(before);
  await settle(page, 1500);
}

/**
 * A point on the game canvas inside one of `tiles` (the first whose middle
 * isn't under a tray handle, a chip or a flag), or null.
 */
async function canvasPoint(page: Page, tiles: { q: number; r: number }[]): Promise<{ x: number; y: number } | null> {
  return page.evaluate((list) => {
    const h = (window as unknown as { __heartpatch?: { hollowed?: () => Hollowed } }).__heartpatch?.hollowed?.();
    if (!h) return null;
    for (const t of list) {
      const rect = h.tileAt(t.q, t.r);
      if (!rect) continue;
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const el = document.elementFromPoint(x, y);
      if (el && el.tagName === 'CANVAS') return { x, y };
    }
    return null;
  }, tiles);
}

async function tapTile(page: Page, tiles: { q: number; r: number }[]): Promise<void> {
  const panel = page.getByTestId('tile-panel');
  for (let attempt = 0; attempt < 4; attempt++) {
    const at = await canvasPoint(page, tiles);
    expect(at, 'a community tile free to tap').not.toBeNull();
    await realTapAt(page, at!.x, at!.y);
    await settle(page, 700);
    if (await panel.isVisible()) return;
    for (const name of ['Close Adventure', 'Close My Home']) {
      const close = page.getByRole('button', { name });
      if (await close.isVisible()) await close.tap({ timeout: 5_000 });
    }
    await settle(page, 500);
  }
  await expect(panel).toBeVisible(slow);
}

async function waitExplore(page: Page): Promise<void> {
  await expect.poll(async () => (await exploreState(page))?.scene?.keeper, slow).toBe(true);
  await expect.poll(async () => (await exploreState(page))?.scene?.drawCalls ?? 0, slow).toBeGreaterThan(0);
  await settle(page, 3500);
}

async function exploreStats(page: Page) {
  const s = await exploreState(page);
  return { drawCalls: s?.scene?.drawCalls, triangles: s?.scene?.triangles, hollowed: s?.hollowed, tile: s?.tile?.terrain };
}

async function leaveExplore(page: Page): Promise<void> {
  console.log('STEP leave explore');
  await page.getByTestId('explore-back').tap();
  await waitMap(page);
  console.log('STEP map back');
}

test('Hollowed Communities mockup captures', async ({ browser }) => {
  const page = await newPlayer(browser, uniqueName('hollow'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Juniper Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden(slow);
  await waitMap(page);
  const mapId = (await mapState(page))!.id;

  if (!FROM_RESTORED) {
    // Baseline: today's explore of the Heart Seed, for the draw-call comparison.
    await reopen(page, 'fps=0&tier=high');
    const mapBaseline = await mapState(page);
    const box = (await page.locator('#game').boundingBox())!;
    await expect(async () => {
      if ((await mapState(page))?.selected == null) {
        await realTapAt(page, box.x + box.width / 2, box.y + box.height / 2);
      }
      await expect(page.getByTestId('tile-explore')).toBeVisible({ timeout: 5_000 });
    }).toPass(slow);
    await page.getByTestId('tile-explore').tap();
    await waitExplore(page);
    const baseline = await exploreStats(page);
    await shot(page, 'explore-today', { baseline });
    await leaveExplore(page);

    // The grey community on the map.
    await reopen(page, 'hollowed=grey&fps=0&tier=high');
    const clusters = (await call<Cluster[]>(page, 'clusters')) ?? [];
    expect(clusters.length).toBeGreaterThan(0);
    const near = clusters.find((c) => c.id === 'near')!;
    await look(page, 'both', 9);
    await shot(page, 'map-grey-wide', { map: await mapState(page), mapBaseline: { drawCalls: mapBaseline?.drawCalls, triangles: mapBaseline?.activeTriangles } });
    await look(page, 'near', 5);
    await shot(page, 'map-grey-near', { map: await mapState(page) });

    // The tile panel and the restore sheet.
    const nearTiles = [near.centre, ...near.tiles.filter((t) => t.q !== near.centre.q || t.r !== near.centre.r)];
    await tapTile(page, nearTiles);
    await settle(page, 800);
    await shot(page, 'panel-hollowed');
    await page.getByTestId('hollowed-restore-open').tap();
    await expect(page.getByTestId('hollowed-sheet')).toBeVisible();
    await settle(page, 600);
    await shot(page, 'restore-sheet');
    await page.getByTestId('hollowed-not-now').tap();
    await expect(page.getByTestId('hollowed-sheet')).toBeHidden();
    // Close the panel so nothing sits over the map while explore opens.
    await page.getByRole('button', { name: 'Close', exact: true }).first().tap().catch(() => {});

    // Explore: grey, then sparks, an echo and the puzzle.
    // Explore opens straight from the dev hook (what the panel's Explore does), so no map tap is needed.
    const openExplore = async (show: string | null) => {
      console.log(`STEP explore ${String(show)}`);
      await call(page, 'show', show);
      await call(page, 'explore', near.centre.q, near.centre.r);
      await waitExplore(page);
    };
    await openExplore(null);
    await shot(page, 'explore-grey', { stats: await exploreStats(page) });
    await leaveExplore(page);
    await openExplore('sparks');
    await shot(page, 'explore-sparks', { stats: await exploreStats(page) });
    await leaveExplore(page);
    await openExplore('echo');
    await shot(page, 'explore-echo', { stats: await exploreStats(page) });
    await leaveExplore(page);
    await openExplore('puzzle');
    await shot(page, 'explore-puzzle', { stats: await exploreStats(page) });
    await leaveExplore(page);

    // The hidden cellar: the cave kit on a hills homestead, lantern-lit.
    console.log('STEP cellar');
    const made = await api<{ q: number; r: number }>(page, 'POST', `/maps/${mapId}/dev/homestead`, { terrain: 'hills' });
    expect(made.status).toBe(201);
    await call(page, 'show', 'cellar');
    await call(page, 'explore', made.body!.q, made.body!.r);
    await waitExplore(page);
    await shot(page, 'explore-cellar', { stats: await exploreStats(page) });
    await leaveExplore(page);
  }

  // Restored: the claim-and-rename moment, then the village joined to my land.
  console.log('STEP restored');
  await reopen(page, 'hollowed=restored&show=rename&fps=0&tier=high');
  const near = ((await call<Cluster[]>(page, 'clusters')) ?? []).find((c) => c.id === 'near')!;
  const nearTiles = [near.centre, ...near.tiles.filter((t) => t.q !== near.centre.q || t.r !== near.centre.r)];
  await look(page, 'near', 5);
  await expect(page.getByTestId('hollowed-sheet')).toBeVisible(slow);
  await settle(page, 2000);
  await shot(page, 'rename-card');
  await call(page, 'closeSheets');
  await dismissHint(page);
  await settle(page, 1200);
  await shot(page, 'map-restored', { map: await mapState(page) });
  // The village's own Heart Seed (owner decision, Q3), then an ordinary village tile.
  await tapTile(page, [near.centre]);
  await settle(page, 800);
  await shot(page, 'panel-seed');
  await page.getByRole('button', { name: 'Close', exact: true }).first().tap().catch(() => {});
  await settle(page, 400);
  await tapTile(page, nearTiles.slice(1));
  await settle(page, 800);
  await shot(page, 'panel-restored');
  await page.getByRole('button', { name: 'Close', exact: true }).first().tap().catch(() => {});
  // The key map (owner decision, Q5): the card, then the flag on the key tile.
  console.log('STEP keymap');
  await call(page, 'show', 'keymap');
  await call(page, 'refresh');
  await call(page, 'openKeyMap');
  await expect(page.getByTestId('hollowed-sheet')).toBeVisible(slow);
  await settle(page, 1200);
  await shot(page, 'keymap-card');
  await call(page, 'closeSheets');
  await look(page, 'key', 5);
  await shot(page, 'keymap-map');
});
