import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Restoring a grey village (#306 PR 3): with my land touching a village and
 * every tile one piece short (the dev routes), each tile's panel opens the
 * restore sheet, its last piece claims the tile, and the village's last tile
 * wins it: the naming card pops, the ring turns mine with its own Heart
 * Seed, and the name goes up on its flag. The win's redraw links no shader
 * program and is announced to the render governor (the owner's freezes,
 * #555 and #569). Checked through the dev hook.
 */

const slowExpect = expect.configure({ timeout: 30_000 });
const slow = { timeout: 30_000 };

interface CommunitiesDebug {
  flags: { label: string }[];
  panel: { community: string; explore: boolean; restore: boolean } | null;
  restore: { card: 'restore' | 'name' | null; piecesDone: number | null; said: string | null };
  villages: { id: string; name: string; restored: number; ownerUserId: string | null }[];
}

interface MapView {
  communities?: {
    id: string;
    square: { q: number; r: number };
    tiles: { q: number; r: number }[];
    reach: string | null;
  }[];
}

type Hooks = {
  __heartpatch?: {
    mapDev?: () => { show(q: number, r: number): boolean };
    qualityDev?: () => { gl(): { programs: number } | null } | null;
  };
};

const communities = (page: Page) => hook<CommunitiesDebug>(page, 'communities');
const hitchesExpected = (page: Page) => hook<number>(page, 'hitchesExpected');
const programs = (page: Page) =>
  page.evaluate(
    () => (window as unknown as Hooks).__heartpatch?.qualityDev?.()?.gl()?.programs ?? null,
  );
const show = (page: Page, at: { q: number; r: number }) =>
  page.evaluate(
    ({ q, r }) => (window as unknown as Hooks).__heartpatch?.mapDev?.().show(q, r) ?? false,
    at,
  );

test('restores a grey village tile by tile, wins it and names it (#306 PR 3)', async ({
  browser,
}) => {
  test.setTimeout(300_000); // a patch, several sheets and a redraw; CI renders in software
  const page = await newPlayer(browser, uniqueName('restorer'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Rekindle Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await slowExpect(lobby.getByRole('button', { name: 'Visit patch' })).toBeVisible();
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Rekindle Patch')!.id;
  // My land reaches my nearest village, and every tile there is one piece short (dev only).
  expect((await api(page, 'POST', `/maps/${mapId}/dev/hollowed-reach`)).status).toBe(201);
  // A Bakery, so its square hands over a morning gift once won (PR 3b).
  const almost = await api<{ id: string }>(page, 'POST', `/maps/${mapId}/dev/village-almost`, {
    kind: 'bakery',
  });
  expect(almost.status, JSON.stringify(almost.body)).toBe(201);
  const view = await api<MapView>(page, 'GET', `/maps/${mapId}/view`);
  const village = view.body.communities!.find((c) => c.id === almost.body.id)!;
  // The square last: the tile that wins the village.
  const key = (h: { q: number; r: number }) => `${String(h.q)},${String(h.r)}`;
  const order = [...village.tiles.filter((t) => key(t) !== key(village.square)), village.square];

  await visitPatch(lobby);
  await slowExpect(lobby).toBeHidden();
  await slowExpect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const restoreButton = page.getByTestId('community-restore');
  const sheet = page.getByTestId('restore-sheet');

  for (const [i, tile] of order.entries()) {
    const last = i === order.length - 1;
    await expect(async () => {
      expect(await show(page, tile)).toBe(true);
      await expect(restoreButton).toBeEnabled({ timeout: 5_000 });
    }).toPass(slow);
    await restoreButton.tap();
    await slowExpect(sheet).toBeVisible();
    await slowExpect(page.getByTestId('restore-note')).toHaveText(
      'The last piece! Whoever adds it claims this tile ✨',
    );
    const piece = page.getByTestId('restore-piece');
    await expect(piece).toBeEnabled();
    const before = { programs: await programs(page), hitches: (await hitchesExpected(page)) ?? 0 };
    await piece.tap();
    if (!last) {
      await slowExpect(page.getByTestId('restore-said')).toHaveText(
        'You restored it! This tile is yours ✨',
      );
      expect(await hitchesExpected(page)).toBeGreaterThan(before.hitches);
      await page.getByTestId('restore-not-now').tap();
      await expect(sheet).toBeHidden();
      continue;
    }

    // The win: the joy-is-back card, and the map redraws the ring as mine.
    await slowExpect(page.getByTestId('village-won-name')).toBeVisible();
    await expect(page.getByTestId('village-seed-line')).toBeVisible();
    expect(await hitchesExpected(page)).toBeGreaterThan(before.hitches);
    await expect
      .poll(
        async () =>
          (await communities(page))?.villages.find((v) => v.id === village.id)?.ownerUserId ?? null,
        slow,
      )
      .not.toBeNull();
    // A redraw of instance data on meshes already built: no shader program linked.
    if (before.programs !== null) expect(await programs(page)).toBe(before.programs);
    // "Name it" opens the naming card, whose button fits on screen.
    await page.getByTestId('village-won-name').tap();
    const box = await page.getByTestId('village-name-it').boundingBox();
    const height = page.viewportSize()!.height;
    expect(box && box.y + box.height <= height).toBe(true);
  }

  // Tap an idea, then name it: the flag says so for everyone.
  const idea = page.getByTestId('village-name-idea').nth(1);
  const name = (await idea.textContent()) ?? '';
  expect(findAvoidedWords(name)).toEqual([]);
  await idea.tap();
  await expect(page.getByTestId('village-name-input')).toHaveValue(name);
  await page.getByTestId('village-name-it').tap();
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => (await communities(page))?.flags.map((f) => f.label) ?? [], slow)
    .toContain(`🏡 ${name}`);
  // Then the map to its cellar key (PR 2c, hollowed-cellar.spec.ts): later.
  await slowExpect(page.getByTestId('key-map-card')).toBeVisible();
  await page.getByTestId('key-map-later').tap();
  await expect(page.getByTestId('key-map-card')).toBeHidden();

  // Its square says what the Bakery does, and hands over this morning's Treats once (PR 3b).
  const perk = page.getByTestId('community-perk');
  await expect(async () => {
    expect(await show(page, village.square)).toBe(true);
    await expect(perk).toHaveText('🥧 Bakery: Treats every morning', { timeout: 5_000 });
  }).toPass(slow);
  await page.getByTestId('community-gift').tap();
  await slowExpect(page.getByTestId('community-said')).toContainText('+3');
  await slowExpect(page.getByTestId('community-gift-taken')).toHaveText(
    'Today’s gift is in your bag! More tomorrow morning 🌅',
  );
  expect(errors).toEqual([]);
});
