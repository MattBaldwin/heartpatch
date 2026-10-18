import { expect, test, type Page } from '@playwright/test';
import { draws, idle } from './dev-hook.js';

/**
 * The quality governor's GPU budget (#501, PR B): once a stage has loaded,
 * a tier change links no shader program and makes no more than a couple of
 * textures (bloom's passes are attached or detached, never rebuilt), and
 * neither does a resolution step beyond one target per pass per new size. Counted on
 * the WebGL context itself (`engine/gl-counters.ts`) on the squishy gallery,
 * a stage with no server behind it.
 */

type Tier = 'high' | 'medium' | 'low';

interface GlCounts {
  buffersMade: number;
  texturesMade: number;
  texturesFreed: number;
  programs: number;
}

/** The dev-only `qualityDev` hook (src/engine/dev-hook.d.ts, which this project can't see). */
type Hooks = {
  __heartpatch?: {
    quality(): { tier: Tier; renderScale: number; pixelRatio: number } | null;
    invalidate(): void;
    qualityDev?(): { hold(tier: Tier, renderScale: number): void; gl(): GlCounts | null } | null;
  };
};

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    // Babylon's own warnings count too (a post-process attached twice only logs).
    const babylonWarning = msg.type() === 'warning' && msg.text().startsWith('BJS -');
    if (msg.type() === 'error' || babylonWarning) errors.push(msg.text());
  });
  return errors;
}

/** Waits until nothing is drawn for `quietMs` and the loop reports idle. */
async function waitForIdle(page: Page, quietMs = 500): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await draws(page);
        await page.waitForTimeout(quietMs);
        return (await idle(page)) && (await draws(page)) === before;
      },
      { timeout: 60_000, intervals: [0] },
    )
    .toBe(true);
}

/** Holds a tier and scale (governor off), waits for the frames it draws, and checks it took. */
async function hold(page: Page, tier: Tier, renderScale: number): Promise<void> {
  const before = await draws(page);
  await page.evaluate(
    ([t, s]) => {
      const hook = (window as Hooks).__heartpatch;
      hook?.qualityDev?.()?.hold(t, s);
      hook?.invalidate(); // a hold that changes nothing still draws, so the wait below ends
    },
    [tier, renderScale] as const,
  );
  await expect.poll(() => draws(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await waitForIdle(page);
  const quality = await page.evaluate(() => (window as Hooks).__heartpatch?.quality() ?? null);
  expect(quality).toMatchObject({ tier, renderScale });
}

function gl(page: Page): Promise<GlCounts> {
  return page.evaluate(() => {
    const counts = (window as Hooks).__heartpatch?.qualityDev?.()?.gl();
    if (!counts) throw new Error('no WebGL context to count');
    return counts;
  });
}

const since = (before: GlCounts, after: GlCounts) => ({
  programs: after.programs - before.programs,
  textures: after.texturesMade - before.texturesMade,
});

test('tier flips and resolution steps rebuild nothing (#501)', async ({ page }) => {
  test.setTimeout(240_000); // first load compiles shaders; CI renders in software
  const errors = watchErrors(page);
  await page.goto('/gallery.html?still&count=12');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('#game')).toHaveAttribute('data-renderer', 'webgl2');
  // The hook has a stage once boot hands it over; counting starts with the first call.
  await expect
    .poll(() => page.evaluate(() => (window as Hooks).__heartpatch?.qualityDev?.()?.gl() ?? null), {
      timeout: 30_000,
    })
    .not.toBeNull();
  // Warm-up: the stage's own load, back at the tier it started on. (A slow
  // software renderer may already have crawled to low on its own.)
  await hold(page, 'high', 1);

  // Forced tier flips, twice through every tier: bloom off, a softer bloom,
  // the full one. Nothing compiles, and nothing is made again on the second
  // round (a rebuilt pipeline makes new targets every time); at most FXAA's
  // target gains a depth buffer the first time it draws first, in place of bloom.
  const beforeFlip = await gl(page);
  for (const tier of ['low', 'medium', 'high', 'low', 'medium', 'high'] as const) {
    await hold(page, tier, 1);
  }
  const flip = since(beforeFlip, await gl(page));
  test.info().annotations.push({ type: 'tier flips', description: JSON.stringify(flip) });
  expect(flip.programs).toBe(0);
  expect(flip.textures).toBeLessThanOrEqual(2);

  // Three resolution steps on the low tier (where a struggling phone ends
  // up: FXAA alone), down twice and back: one new target per new size, and
  // a size seen a moment ago is reused.
  await hold(page, 'low', 1);
  const beforeSteps = await gl(page);
  for (const scale of [0.9, 0.8, 0.9]) await hold(page, 'low', scale);
  const steps = since(beforeSteps, await gl(page));
  test.info().annotations.push({ type: 'scale steps', description: JSON.stringify(steps) });
  expect(steps.programs).toBe(0);
  expect(steps.textures).toBeLessThanOrEqual(2);

  // The same steps with bloom on (a governor's first answer to a slow spell
  // is a cut at its tier): the blur kernel follows the pixel ratio, not the
  // scale, so nothing recompiles; each new size needs bloom's four targets
  // and FXAA's, the one seen a moment ago none.
  await hold(page, 'high', 1);
  const beforeBloomSteps = await gl(page);
  for (const scale of [0.9, 0.8, 0.9]) await hold(page, 'high', scale);
  const bloomSteps = since(beforeBloomSteps, await gl(page));
  test
    .info()
    .annotations.push({ type: 'bloom scale steps', description: JSON.stringify(bloomSteps) });
  expect(bloomSteps.programs).toBe(0);
  expect(bloomSteps.textures).toBeLessThanOrEqual(2 * 5);

  expect(errors).toEqual([]);
});
