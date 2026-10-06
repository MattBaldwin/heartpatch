import { SPECIES } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { draws, idle } from './dev-hook.js';

/**
 * The dev squishy gallery (`/gallery.html`, issue #9). Everything is checked
 * through the dev hook's signals (counts, hashes, flags), never pixels.
 */

interface Stats {
  squishies: number;
  meshes: number;
  instances: number;
  lod: 'low' | 'high';
}

interface Look {
  id: string;
  visual: { body: string; palette: string[]; parts: string[] };
}

/** The dev-only hooks from gallery-main.ts (typed in gallery-hook.d.ts, which this project can't see). */
interface GalleryHook {
  stats(): Stats | null;
  shown(): string[];
  coverage(): {
    bodies: string[];
    parts: string[];
    registryBodies: string[];
    registryParts: string[];
  };
  missing(): string[];
  paramsHash(species: Look, instanceId: string): string;
  squishyHash(i: number): string | null;
  screenPoint(i: number): { x: number; y: number } | null;
  lastTapped(): number | null;
  playing(i: number): boolean;
  play(move: 'jiggle' | 'wobble' | 'bounce'): void;
  animating(): boolean;
}

type Hooks = { __heartpatchGallery?: GalleryHook };

/**
 * Same look and instance as `GOLDEN` in src/procedural/params.test.ts. That
 * test pins the hash in Node (V8); this one checks it in the browser under
 * test (WebKit in CI), proving every engine builds the same squishy.
 */
const GOLDEN_LOOK: Look = {
  id: 'test-puff',
  visual: {
    body: 'blob',
    palette: ['#ffb3c7', '#fff4ea'],
    parts: ['dot-eyes', 'smile', 'round-ears', 'spots'],
  },
};
const GOLDEN_HASH = '126b1077d330d830ffaa427a5be36a55';
/** A roster species to repeat across the scene (any species works). */
const GOLDEN_SPECIES = SPECIES[0]!.id;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    // Babylon's own warnings count too (a missing side-effect import only warns);
    // the browser's GPU driver chatter doesn't.
    const babylonWarning = msg.type() === 'warning' && msg.text().startsWith('BJS -');
    if (msg.type() === 'error' || babylonWarning) errors.push(msg.text());
  });
  return errors;
}

async function openGallery(page: Page, query = ''): Promise<Stats> {
  await page.goto(`/gallery.html${query}`);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => (window as Hooks).__heartpatchGallery?.stats() ?? null), {
      timeout: 30_000,
    })
    .not.toBeNull();
  return (await page.evaluate(() => (window as Hooks).__heartpatchGallery!.stats()))!;
}

/** Waits until nothing is drawn for `quietMs` and the loop reports idle (see smoke.spec.ts). */
async function waitForIdle(page: Page, quietMs = 500): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await draws(page);
        await page.waitForTimeout(quietMs);
        const isIdle = await idle(page);
        return isIdle && (await draws(page)) === before;
      },
      { timeout: 30_000, intervals: [0] },
    )
    .toBe(true);
}

test('shows every body and part in the registry, with no errors', async ({ page }) => {
  test.setTimeout(90_000); // first load compiles shaders; CI renders in software
  const errors = watchErrors(page);
  const stats = await openGallery(page, '?still');
  await expect(page.locator('#game')).toHaveAttribute('data-renderer', 'webgl2');

  const info = await page.evaluate(() => {
    const hook = (window as Hooks).__heartpatchGallery!;
    return { coverage: hook.coverage(), shown: hook.shown(), missing: hook.missing() };
  });
  // Every species in the roster (#10) is on screen, ahead of the showcase looks.
  expect(info.shown.slice(0, SPECIES.length)).toEqual(SPECIES.map((s) => s.id));
  expect(info.coverage.bodies.toSorted()).toEqual(info.coverage.registryBodies.toSorted());
  expect(info.coverage.parts.toSorted()).toEqual(info.coverage.registryParts.toSorted());
  expect(info.missing).toEqual([]);
  expect(stats.squishies).toBe(info.shown.length);
  expect(stats.lod).toBe('low'); // map view
  await expect(page.getByTestId('gallery-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the same species and instance id always build the same squishy', async ({ page }) => {
  test.setTimeout(90_000);
  // One look repeated, so squishies differ only by instance id.
  const query = `?still&count=12&look=${GOLDEN_SPECIES}`;
  await openGallery(page, query);
  const first = await page.evaluate(
    ({ look }) => {
      const hook = (window as Hooks).__heartpatchGallery!;
      return {
        golden: hook.paramsHash(look, 'golden-1'),
        other: hook.paramsHash(look, 'golden-2'),
        squishies: [0, 1, 11].map((i) => hook.squishyHash(i)),
        shown: hook.shown(),
      };
    },
    { look: GOLDEN_LOOK },
  );
  expect(first.golden).toBe(GOLDEN_HASH);
  expect(first.other).not.toBe(GOLDEN_HASH);
  // Every squishy is the same look with a different instance id: alike, not identical.
  expect(new Set(first.shown)).toEqual(new Set([GOLDEN_SPECIES]));
  expect(new Set(first.squishies).size).toBe(first.squishies.length);

  await page.reload();
  await openGallery(page, query);
  const again = await page.evaluate(() =>
    [0, 1, 11].map((i) => (window as Hooks).__heartpatchGallery!.squishyHash(i)),
  );
  expect(again).toEqual(first.squishies);
});

test('draw calls stay flat as squishies multiply (shared geometry, thin instances)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Every look once, then every look twice: the same shapes, twice the squishies.
  const once = await openGallery(page, '?still');
  const twice = await openGallery(page, `?still&count=${String(once.squishies * 2)}`);
  expect(twice.squishies).toBe(once.squishies * 2);
  expect(twice.meshes).toBe(once.meshes);
  expect(twice.meshes).toBeLessThanOrEqual(16);
  expect(twice.instances).toBe(once.instances * 2);
});

test('tapping a squishy jiggles it, then the still scene goes idle again', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page); // e.g. Babylon's "Ray needs to be imported" when picking
  await openGallery(page, '?still&view=closeup');
  await waitForIdle(page);

  const point = await page.evaluate(() => (window as Hooks).__heartpatchGallery!.screenPoint(0));
  expect(point).not.toBeNull();
  const before = await draws(page);
  // A short, still touch (synthetic pointer events behave alike in WebKit and
  // Chromium). Read the result in the same task: a slow software-rendered
  // frame could outlast the jiggle before the next evaluate.
  const tapped = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#game')!;
    for (const type of ['pointerdown', 'pointerup']) {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    const hook = (window as Hooks).__heartpatchGallery!;
    return { last: hook.lastTapped(), playing: hook.playing(0) };
  }, point!);
  expect(tapped).toEqual({ last: 0, playing: true });
  await expect.poll(() => draws(page)).toBeGreaterThan(before);
  await waitForIdle(page);
  expect(await page.evaluate(() => (window as Hooks).__heartpatchGallery!.playing(0))).toBe(false);
  expect(errors).toEqual([]);
});

test('breathing keeps drawing; moves play on every squishy', async ({ page }) => {
  test.setTimeout(90_000);
  await openGallery(page, '?count=4');
  expect(await page.evaluate(() => (window as Hooks).__heartpatchGallery!.animating())).toBe(true);
  const before = await draws(page);
  await expect.poll(() => draws(page)).toBeGreaterThan(before + 2);

  // Read in the same task as the play, so a slow frame can't outlast the bounce.
  const playing = await page.evaluate(() => {
    const hook = (window as Hooks).__heartpatchGallery!;
    hook.play('bounce');
    return [0, 1, 2, 3].map((i) => hook.playing(i));
  });
  expect(playing).toEqual([true, true, true, true]);
});

test('detail follows the view and the quality tier', async ({ page }) => {
  test.setTimeout(120_000);
  expect((await openGallery(page, '?still&view=closeup')).lod).toBe('high');
  expect((await openGallery(page, '?still&view=closeup&quality=low')).lod).toBe('low');
  expect((await openGallery(page, '?still&quality=high')).lod).toBe('low');
});
