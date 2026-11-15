import { mkdirSync } from 'node:fs';
import {
  CatalogResponseSchema,
  SPECIES,
  SpeciesSchema,
  type Species,
} from '@heartpatch/shared';
import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { hook } from './dev-hook.js';
import { pickKeeper, signUp, uniqueName, visitPatch } from './players.js';
import { closeTrays, openTray } from './trays.js';

// THROWAWAY capture spec for #190 part 190f (untracked; delete after).
const OUT = '/tmp/claude-0/-home-user-heartpatch/9b1782fe-7578-5253-9f79-0b3e57f4a71d/scratchpad/190f';
mkdirSync(OUT, { recursive: true });

interface BossMarker { name: string; known: boolean; until: string; x: number; y: number }
interface ViewTile { q: number; r: number; terrain: string; ownerUserId: string | null }

const base = SPECIES.find((s) => s.rarity === 'rare' && s.evolutions.length === 0) ?? SPECIES.find((s) => s.rarity === 'rare')!;
const RAKELET: Species = SpeciesSchema.parse({
  ...base,
  id: 'rakelet',
  name: 'Rakelet',
  description: 'A giant leafy friend who stomps about for a week.',
  evolutions: [],
  season: undefined,
  visual: { ...base.visual, palette: ['#f4b27a', '#e07f3f', '#8fbf5a', '#3a2540'] },
  line: 'boss',
});
delete (RAKELET as { season?: string }).season;

async function player(browser: Browser, size: { width: number; height: number }) {
  const { userAgent, isMobile, hasTouch, baseURL } = test.info().project.use;
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    ...(userAgent ? { userAgent } : {}),
    ...(isMobile ? { isMobile } : {}),
    ...(hasTouch ? { hasTouch } : {}),
    ...(baseURL ? { baseURL } : {}),
  });
  await context.addInitScript(() => {
    const g = window as unknown as Record<string, unknown>;
    g['AudioContext'] = undefined;
    g['webkitAudioContext'] = undefined;
  });
  // WS: pass everything through, remember the latest seq per map so an injected event fits.
  const seqs = new Map<string, number>();
  let route: WebSocketRoute | null = null;
  await context.routeWebSocket(/\/ws$/, (ws) => {
    route = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      try {
        const j = JSON.parse(String(m)) as { mapId?: string; seq?: number };
        if (j.mapId && typeof j.seq === 'number') seqs.set(j.mapId, Math.max(seqs.get(j.mapId) ?? 0, j.seq));
      } catch { /* */ }
      ws.send(m);
    });
  });
  const page = await context.newPage();
  await signUp(page, uniqueName('cap'));
  await pickKeeper(page);
  await expect(page.getByTestId('lobby').getByRole('heading', { name: 'Your patches' })).toBeVisible({ timeout: 15_000 });
  const inject = (mapId: string, data: Record<string, unknown>) => {
    const seq = (seqs.get(mapId) ?? 0) + 1;
    seqs.set(mapId, seq);
    route!.send(JSON.stringify({ v: 1, type: 'boss.appeared', mapId, seq, at: new Date().toISOString(), data }));
  };
  return { page, inject };
}

type BossState = { mode: 'none' | 'unknown' | 'named'; tile?: { q: number; r: number }; endsAt: string };

async function mockBoss(page: Page, state: BossState) {
  await page.route('**/api/v1/maps/*/boss', async (route) => {
    if (state.mode === 'none' || !state.tile) return route.fulfill({ json: { boss: null } });
    await route.fulfill({
      json: {
        boss: {
          window: { id: '2026-11-09', endsAt: state.endsAt },
          tile: state.tile,
          species: state.mode === 'named' ? 'rakelet' : null,
          state: 'here',
          triesLeftToday: 2,
        },
      },
    });
  });
  await page.route('**/api/v1/maps/*/catalog', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { catalog: { entries: unknown[]; speciesDefs: unknown[] } };
    if (state.mode === 'named') {
      body.catalog.speciesDefs.push(RAKELET);
      body.catalog.entries.push({ speciesId: 'rakelet', firstSeenAt: new Date(Date.now() - 3_600_000).toISOString(), firstCaughtAt: null });
    }
    CatalogResponseSchema.parse(body);
    await route.fulfill({ response: res, json: body });
  });
}

async function openMap(page: Page, patch: string) {
  await page.goto('/?tier=high');
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({ timeout: 30_000 });
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill(patch);
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.getByTestId('tray-hint-ok').tap();
  const mapId = async () => (await hook<{ id: string }>(page, 'map'))?.id ?? '';
  await expect.poll(mapId, { timeout: 30_000 }).not.toBe('');
  const id = await mapId();
  const tiles = await page.evaluate(async (m) => {
    const res = await fetch(`/api/v1/maps/${m}/view`);
    return ((await res.json()) as { tiles: ViewTile[] }).tiles;
  }, id);
  return { id, tiles };
}

function pickTile(tiles: ViewTile[]) {
  // A free meadow near the middle of the patch (so it's on screen at the opening zoom).
  const free = tiles.filter((t) => t.ownerUserId === null && t.terrain === 'meadow');
  free.sort((a, b) => Math.hypot(a.q + a.r / 2, a.r) - Math.hypot(b.q + b.r / 2, b.r));
  return free[2] ?? free[0] ?? tiles[0]!;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
const settle = (page: Page, ms = 1500) => page.waitForTimeout(ms);

test.afterEach(async ({ browser }) => {
  for (const c of browser.contexts()) await c.close();
});

test('190f iphone frames', async ({ browser }) => {
  test.skip(test.info().project.name !== 'iphone-chromium');
  test.setTimeout(400_000);
  const { page, inject } = await player(browser, { width: 393, height: 852 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const state: BossState = { mode: 'none', endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() };
  await mockBoss(page, state);
  const { id, tiles } = await openMap(page, 'Stomp Patch');
  console.log('quality', JSON.stringify(await hook(page, 'quality')));
  const tile = pickTile(tiles);
  state.tile = { q: tile.q, r: tile.r };
  await closeTrays(page);
  await settle(page, 3000);

  // 3a: unknown boss arrives live.
  state.mode = 'unknown';
  inject(id, { window: '2026-11-09', q: tile.q, r: tile.r, endsAt: state.endsAt });
  await expect(page.getByText('Something BIG is stomping around the meadow!')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(400);
  await shot(page, '3a-patchline-unknown');
  await expect(page.getByText('Something BIG is stomping around the meadow!')).toBeHidden({ timeout: 10_000 });

  // 1: unknown marker.
  await expect.poll(async () => (await hook<BossMarker>(page, 'boss'))?.name, { timeout: 30_000 }).toBe('A BIG squishy');
  console.log('marker1', JSON.stringify(await hook(page, 'boss')));
  await settle(page);
  await shot(page, '1-marker-unknown');

  // 4: tile card.
  const panel = page.getByTestId('tile-panel');
  await expect(async () => {
    const now = (await hook<BossMarker>(page, 'boss'))!;
    await tapCanvas(page, now.x, now.y);
    await expect(panel.getByTestId('boss-card')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await settle(page, 1000);
  console.log('card', await panel.innerText());
  await shot(page, '4-tile-card');
  await page.keyboard.press('Escape');
  const close = panel.getByRole('button', { name: /close|×|not now/i }).first();
  if (await close.isVisible().catch(() => false)) await close.tap();
  await expect(panel).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
  await settle(page);

  // 3b: named boss (met: catalog has its def).
  state.mode = 'named';
  inject(id, { window: '2026-11-09', q: tile.q, r: tile.r, endsAt: state.endsAt });
  await expect(page.getByText('A giant Rakelet is stomping about!')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(400);
  await shot(page, '3b-patchline-named');
  await expect(page.getByText('A giant Rakelet is stomping about!')).toBeHidden({ timeout: 10_000 });

  // 2: named marker.
  await expect.poll(async () => (await hook<BossMarker>(page, 'boss'))?.name, { timeout: 30_000 }).toBe('Rakelet');
  console.log('marker2', JSON.stringify(await hook(page, 'boss')));
  await settle(page);
  await shot(page, '2-marker-named');

  // 5: catalog.
  await openTray(page, 'adventure');
  await page.getByTestId('catalog-open').tap();
  await expect.poll(async () => (await hook<{ loading: boolean }>(page, 'catalog'))?.loading, { timeout: 15_000 }).toBe(false);
  const cat = await hook<{ names: string[] }>(page, 'catalog');
  console.log('catalog names', JSON.stringify(cat));
  const card = page.getByTestId('catalog-entry').filter({ hasText: 'Rakelet' });
  await card.scrollIntoViewIfNeeded();
  await settle(page, 1000);
  await shot(page, '5-catalog');
  await page.getByTestId('catalog-close-top').tap();

  // 6: milestones (real server data), from the lobby's wardrobe shortcut.
  await page.goto('/?tier=high');
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({ timeout: 30_000 });
  await lobby.getByTestId('wardrobe-open').tap();
  await page.getByTestId('wardrobe-milestones').tap();
  const ms = page.getByTestId('milestones');
  await expect(ms).toBeVisible();
  const track = ms.locator('[data-track="big-friend"]');
  await expect(track).toBeVisible({ timeout: 15_000 });
  await track.scrollIntoViewIfNeeded();
  await settle(page, 800);
  console.log('track', await track.innerText());
  await shot(page, '6-milestones');
  console.log('errors', JSON.stringify(errors));
});

test('190f ipad frame', async ({ browser }) => {
  test.skip(test.info().project.name !== 'ipad-chromium');
  test.setTimeout(300_000);
  const { page } = await player(browser, { width: 820, height: 1180 });
  const state: BossState = { mode: 'none', endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() };
  await mockBoss(page, state);
  // Pick the tile once the map id is known: the mock answers null until then, then a refresh.
  const { tiles } = await openMap(page, 'Stomp Patch');
  const tile = pickTile(tiles);
  state.tile = { q: tile.q, r: tile.r };
  state.mode = 'named';
  await closeTrays(page);
  // Re-open the map so the store asks again.
  await page.reload();
  const lobby = page.getByTestId('lobby');
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
  if (await lobby.isVisible()) await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  const hint = page.getByTestId('tray-hint-ok');
  if (await hint.isVisible().catch(() => false)) await hint.tap();
  await expect.poll(async () => (await hook<BossMarker>(page, 'boss'))?.name, { timeout: 30_000 }).toBe('Rakelet');
  console.log('quality', JSON.stringify(await hook(page, 'quality')));
  console.log('marker', JSON.stringify(await hook(page, 'boss')));
  await settle(page, 2500);
  await shot(page, '7-ipad-marker-named');
});
