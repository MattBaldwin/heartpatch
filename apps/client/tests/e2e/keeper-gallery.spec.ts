import { expect, test, type Page } from '@playwright/test';
import { draws, idle } from './dev-hook.js';

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
  shadersReady(): boolean;
}

type Hooks = { __heartpatchKeepers?: KeeperGalleryHook };

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
const GOLDEN_HASH = 'f67f57c65bda360a6505de085f1de322';

/**
 * Babylon's report of a shader variant that failed to compile or link, which
 * it then recovers from with a fallback: "Unable to compile effect:", its
 * Uniforms / Attributes / Defines dump, the variant's vertex and fragment code
 * when the failed pipeline still holds it ("Vertex code:", then the code), an
 * `Error:` and "Trying next fallback.". Headless WebKit in CI has no GPU and
 * intermittently fails a variant this way (#17's CI on PR #75; #224 and #226
 * with the squish plugin's variants), so these lines alone aren't a failure.
 *
 * Babylon logs the error's `stack`, and WebKit's stack leaves out the message,
 * so the `Error:` line never shows the GL log. `watchErrors` prints the real
 * shader and program info logs to the test's output instead.
 *
 * Every other console error or Babylon warning still fails a test. So does a
 * variant whose fallbacks all fail: `openGallery` waits for every shown mesh's
 * shader to be ready. The tests' own assertions (every slot on every base,
 * hashes) still catch a Keeper that didn't build.
 */
const SHADER_FALLBACK_NOISE = [
  /^Unable to compile effect:/,
  /^(Uniforms|Attributes|Defines):/,
  /^(Vertex|Fragment) code:$/,
  /^#version 300 es\n/, // the code itself
  /^Error: [\w$.<>]*@\S+:\d+:\d+/, // WebKit: the stack, without the message
  /^Trying next fallback\.$/,
];

const GL_INFO_LOG = 'GL info log: ';

function isShaderFallbackNoise(text: string): boolean {
  const body = text.replace(/^BJS - \[[\d:]+\]: /, '');
  return text.startsWith('BJS -') && SHADER_FALLBACK_NOISE.some((re) => re.test(body));
}

/**
 * Collects console errors and Babylon warnings, less the shader fallback
 * report. Non-empty shader and program info logs (what a failed variant's
 * `Error:` line can't show on WebKit) go to the test's output.
 */
async function watchErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  await page.addInitScript((prefix) => {
    const proto = WebGL2RenderingContext.prototype;
    const report = (name: string, log: string | null) => {
      if (log?.trim()) console.info(`${prefix}${name}: ${log.trim()}`);
      return log;
    };
    type InfoLog<T> = (this: WebGL2RenderingContext, of: T) => string | null;
    const original = <T>(name: string) =>
      Object.getOwnPropertyDescriptor(proto, name)!.value as InfoLog<T>;
    const shaderLog = original<WebGLShader>('getShaderInfoLog');
    const programLog = original<WebGLProgram>('getProgramInfoLog');
    proto.getShaderInfoLog = function (this: WebGL2RenderingContext, shader: WebGLShader) {
      return report('shader', shaderLog.call(this, shader));
    };
    proto.getProgramInfoLog = function (this: WebGL2RenderingContext, program: WebGLProgram) {
      return report('program', programLog.call(this, program));
    };
  }, GL_INFO_LOG);
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.text().startsWith(GL_INFO_LOG)) {
      console.log(`[${test.info().project.name}] ${msg.text()}`);
      return;
    }
    const babylonWarning = msg.type() === 'warning' && msg.text().startsWith('BJS -');
    if ((msg.type() === 'error' || babylonWarning) && !isShaderFallbackNoise(msg.text())) {
      errors.push(msg.text());
    }
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
  // A variant that failed may still be compiling a fallback; one whose
  // fallbacks all failed never gets here.
  await expect
    .poll(() => page.evaluate(() => (window as Hooks).__heartpatchKeepers!.shadersReady()), {
      timeout: 30_000,
    })
    .toBe(true);
  return (await page.evaluate(() => (window as Hooks).__heartpatchKeepers!.stats()))!;
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

test('shows all 12 Keeper bases, with no errors', async ({ page }) => {
  test.setTimeout(90_000); // first load compiles shaders; CI renders in software
  const errors = await watchErrors(page);
  const stats = await openGallery(page);
  await expect(page.locator('#game')).toHaveAttribute('data-renderer', 'webgl2');
  const info = await page.evaluate(() => {
    const h = (window as Hooks).__heartpatchKeepers!;
    return { shown: h.shown(), bases: h.registryBases(), missing: h.missing() };
  });
  expect(info.bases).toHaveLength(12);
  expect(info.shown.toSorted()).toEqual(info.bases.toSorted());
  expect(info.missing).toEqual([]);
  expect(stats).toMatchObject({ keepers: 12, lod: 'low' });
  await expect(page.getByTestId('keeper-gallery-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('every hairstyle draws on a Keeper, each one different', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await watchErrors(page);
  const stats = await openGallery(page, '?base=pip&hair=all');
  expect(stats).toMatchObject({ keepers: 12 });
  const info = await page.evaluate(() => {
    const h = (window as Hooks).__heartpatchKeepers!;
    return { hashes: h.shown().map((_, i) => h.hashOf(i)), missing: h.missing() };
  });
  expect(new Set(info.hashes).size).toBe(12);
  expect(info.missing).toEqual([]);
  expect(errors).toEqual([]);
});

test('every wardrobe slot attaches to every base (no clothing is body-type locked)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await watchErrors(page);
  await openGallery(page, '?items=all');
  const worn = await page.evaluate(() => {
    const h = (window as Hooks).__heartpatchKeepers!;
    return h.shown().map((_, i) => h.slotsWorn(i));
  });
  expect(worn).toHaveLength(12);
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
  const twelve = await openGallery(page, '?items=all');
  const sixty = await openGallery(page, '?items=all&count=60');
  expect(sixty.keepers).toBe(60);
  expect(sixty.meshes).toBe(twelve.meshes);
  // Five primitive shapes plus the contact shadows.
  expect(sixty.meshes).toBeLessThanOrEqual(6);
  expect(sixty.instances).toBeGreaterThan(twelve.instances * 4);
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
