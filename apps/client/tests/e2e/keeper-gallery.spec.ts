import { expect, test, type Page } from '@playwright/test';

/**
 * The dev Keeper gallery (`/keepers.html`, issue #42). Everything is checked
 * through the dev hook's signals (counts, slots, hashes, flags), never pixels.
 */

interface Stats {
  keepers: number;
  meshes: number;
  instances: number;
  lod: 'low' | 'high';
}

interface KeeperConfig {
  base: string;
  hairColor: string;
  eyeColor: string;
  outfit: string;
}

const SLOTS = ['hat', 'hair-accessory', 'top', 'bottom', 'shoes', 'back', 'held', 'costume'];

/** The dev-only hooks from keeper-gallery-main.ts (typed in keeper-gallery-hook.d.ts). */
interface KeeperGalleryHook {
  stats(): Stats | null;
  shown(): string[];
  registryBases(): string[];
  slotsWorn(i: number): string[];
  missing(): string[];
  keeperHash(config: KeeperConfig, slots: readonly string[]): string;
  hashOf(i: number): string | null;
  playing(i: number): boolean;
  play(move: 'jiggle' | 'wobble' | 'bounce'): void;
  animating(): boolean;
}

interface EngineHook {
  draws(): number;
  idle(): boolean;
}

type Hooks = { __heartpatchKeepers?: KeeperGalleryHook; __heartpatch?: EngineHook };

/**
 * Same config as `GOLDEN_CONFIG` in src/procedural/keeper/keeper-params.test.ts.
 * That test pins the hash in Node (V8); this one checks it in the browser
 * under test (WebKit in CI), proving every engine builds the same Keeper.
 */
const GOLDEN_CONFIG: KeeperConfig = {
  base: 'wren',
  hairColor: 'mint',
  eyeColor: 'violet',
  outfit: 'pumpkin',
};
const GOLDEN_HASH = '9efc3ab44341fc2c668962479b508477';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const babylonWarning = msg.type() === 'warning' && msg.text().startsWith('BJS -');
    if (msg.type() === 'error' || babylonWarning) errors.push(msg.text());
  });
  return errors;
}

async function openGallery(page: Page, query = ''): Promise<Stats> {
  await page.goto(`/keepers.html${query}`);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => (window as Hooks).__heartpatchKeepers?.stats() ?? null), {
      timeout: 30_000,
    })
    .not.toBeNull();
  return (await page.evaluate(() => (window as Hooks).__heartpatchKeepers!.stats()))!;
}

const draws = (page: Page) => page.evaluate(() => (window as Hooks).__heartpatch?.draws() ?? 0);

/** Waits until nothing is drawn for `quietMs` and the loop reports idle (see smoke.spec.ts). */
async function waitForIdle(page: Page, quietMs = 500): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await draws(page);
        await page.waitForTimeout(quietMs);
        const idle = await page.evaluate(() => (window as Hooks).__heartpatch?.idle() ?? false);
        return idle && (await draws(page)) === before;
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true);
}

test('shows all 8 Keeper bases, with no errors', async ({ page }) => {
  test.setTimeout(90_000); // first load compiles shaders; CI renders in software
  const errors = watchErrors(page);
  const stats = await openGallery(page);
  await expect(page.locator('#game')).toHaveAttribute('data-renderer', 'webgl2');
  const info = await page.evaluate(() => {
    const h = (window as Hooks).__heartpatchKeepers!;
    return { shown: h.shown(), bases: h.registryBases(), missing: h.missing() };
  });
  expect(info.bases).toHaveLength(8);
  expect(info.shown.toSorted()).toEqual(info.bases.toSorted());
  expect(info.missing).toEqual([]);
  expect(stats).toMatchObject({ keepers: 8, lod: 'low' });
  await expect(page.getByTestId('keeper-gallery-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('every wardrobe slot attaches to every base (no clothing is body-type locked)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await openGallery(page, '?items=all');
  const worn = await page.evaluate(() => {
    const h = (window as Hooks).__heartpatchKeepers!;
    return h.shown().map((_, i) => h.slotsWorn(i));
  });
  expect(worn).toHaveLength(8);
  for (const slots of worn) expect(slots).toEqual(SLOTS.filter((s) => s !== 'costume'));

  // A costume goes over everything else, on every base.
  await openGallery(page, '?items=costume');
  const costumes = await page.evaluate(() => {
    const h = (window as Hooks).__heartpatchKeepers!;
    return h.shown().map((_, i) => h.slotsWorn(i));
  });
  for (const slots of costumes) expect(slots).toEqual(['costume']);
  expect(errors).toEqual([]);
});

test('the same config always builds the same Keeper, on this engine too', async ({ page }) => {
  test.setTimeout(90_000);
  await openGallery(page);
  const first = await page.evaluate(
    ({ config }) => {
      const h = (window as Hooks).__heartpatchKeepers!;
      return {
        golden: h.keeperHash(config, []),
        dressed: h.keeperHash(config, ['hat']),
        other: h.keeperHash({ ...config, hairColor: 'cocoa' }, []),
        shown: [0, 3, 7].map((i) => h.hashOf(i)),
      };
    },
    { config: GOLDEN_CONFIG },
  );
  expect(first.golden).toBe(GOLDEN_HASH);
  expect(first.dressed).not.toBe(GOLDEN_HASH);
  expect(first.other).not.toBe(GOLDEN_HASH);

  await page.reload();
  await openGallery(page);
  const again = await page.evaluate(() =>
    [0, 3, 7].map((i) => (window as Hooks).__heartpatchKeepers!.hashOf(i)),
  );
  expect(again).toEqual(first.shown);
});

test('draw calls stay flat as Keepers multiply (shared geometry, thin instances)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const eight = await openGallery(page, '?items=all');
  const forty = await openGallery(page, '?items=all&count=40');
  expect(forty.keepers).toBe(40);
  expect(forty.meshes).toBe(eight.meshes);
  // Five primitive shapes plus the contact shadows.
  expect(forty.meshes).toBeLessThanOrEqual(6);
  expect(forty.instances).toBeGreaterThan(eight.instances * 4);
});

test('an idle Keeper never draws; a cheer plays, then the scene goes idle again', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openGallery(page, '?view=closeup');
  await waitForIdle(page);
  expect(await page.evaluate(() => (window as Hooks).__heartpatchKeepers!.animating())).toBe(false);

  const before = await draws(page);
  // Read in the same task as the play, so a slow frame can't outlast the hop.
  const playing = await page.evaluate(() => {
    const h = (window as Hooks).__heartpatchKeepers!;
    h.play('bounce');
    return h.playing(0);
  });
  expect(playing).toBe(true);
  await expect.poll(() => draws(page)).toBeGreaterThan(before);
  await waitForIdle(page);
  expect(await page.evaluate(() => (window as Hooks).__heartpatchKeepers!.playing(0))).toBe(false);
});

test('detail follows the view and the quality tier', async ({ page }) => {
  test.setTimeout(120_000);
  expect((await openGallery(page, '?view=closeup')).lod).toBe('high');
  expect((await openGallery(page, '?view=closeup&quality=low')).lod).toBe('low');
  expect((await openGallery(page, '?quality=high')).lod).toBe('low');
});
