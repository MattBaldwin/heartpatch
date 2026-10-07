import { expect, test, type Page } from '@playwright/test';
import { draws, hook, idle, invalidate } from './dev-hook.js';

interface Point {
  x: number;
  y: number;
}

interface CameraState {
  target: { x: number; z: number };
  distance: number;
  flinging: boolean;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * The part of the dev-only hook (src/engine/dev-hook.d.ts, which this project
 * can't see) that waitForFlingToSettle reads in one go, inside the page.
 */
interface DevHook {
  camera(): CameraState | null;
  draws(): number;
}

async function cameraState(page: Page): Promise<CameraState> {
  const state = await hook<CameraState>(page, 'camera');
  if (!state) throw new Error('camera not ready');
  return state;
}

/**
 * Plays touch pointer frames on the canvas, 16 ms apart. Each frame lists
 * every active finger's position; fingers missing from the next frame lift.
 * Synthetic PointerEvents behave the same in WebKit and Chromium. Frames are
 * spaced with a busy-wait, not timers: CI renders in software, where a 16 ms
 * timer can take 300 ms and every flick would look like a slow drag.
 */
async function touch(page: Page, frames: Record<number, Point>[]): Promise<void> {
  await page.evaluate((frames) => {
    const canvas = document.querySelector('#game')!;
    const fire = (type: string, id: number, p: Point) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 1,
          clientX: p.x,
          clientY: p.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    let prev: Record<number, Point> = {};
    for (const frame of [...frames, {}]) {
      for (const [id, p] of Object.entries(frame)) {
        fire(id in prev ? 'pointermove' : 'pointerdown', Number(id), p);
      }
      for (const [id, p] of Object.entries(prev)) {
        if (!(id in frame)) fire('pointerup', Number(id), p);
      }
      prev = frame;
      const until = performance.now() + 16;
      while (performance.now() < until) {
        // spin: keeps event timestamps 16 ms apart regardless of frame rate
      }
    }
  }, frames);
}

/**
 * More frames than any fling can glide for. A frame integrates at most 0.1 s
 * of glide (`MAX_INERTIA_DT`, src/engine/camera/map-camera.ts), and even the
 * fastest fling slows to the stop speed within about 1.5 s of glide time
 * (`inertiaTimeConstant` 0.32 s, src/engine/config.ts): ~15 slow frames, or
 * ~180 at 120 fps.
 */
const FLING_FRAME_CEILING = 600;

/**
 * Waits for a fling to stop, counted in drawn frames rather than seconds: a
 * software-rendered iPad can take a second or more per frame, so how long the
 * glide takes says nothing. Fails if it's still gliding after more frames
 * than any glide needs. The test's own timeout is the only clock.
 */
async function waitForFlingToSettle(page: Page): Promise<void> {
  const start = await draws(page);
  await page.waitForFunction(
    ([start, ceiling]) => {
      const hook = (window as unknown as { __heartpatch?: DevHook }).__heartpatch;
      return hook?.camera()?.flinging === false || (hook?.draws() ?? 0) - start > ceiling;
    },
    [start, FLING_FRAME_CEILING] as const,
    { timeout: 0, polling: 100 },
  );
  const frames = (await draws(page)) - start;
  expect((await cameraState(page)).flinging, `still gliding after ${String(frames)} frames`).toBe(
    false,
  );
}

/**
 * Waits until nothing is drawn for a whole `quietMs`. Uses the engine's own
 * draw counter, not the dev overlay, whose text refreshes only every 500 ms
 * and can still show a previous stage's state.
 */
async function waitForIdle(page: Page, quietMs = 500, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await draws(page);
        await page.waitForTimeout(quietMs);
        // Draw count unchanged *and* the loop itself reports idle, so one very
        // slow frame (software rendering) can't pass for idleness.
        const isIdle = await idle(page);
        return isIdle && (await draws(page)) === before;
      },
      { timeout, intervals: [0] },
    )
    .toBe(true);
}

/**
 * PNG of the canvas alone (DOM overlays hidden). Only its size is checked:
 * WebKit's compositor can change screenshot bytes while nothing is drawn, so
 * idleness is asserted on the draw counter, never on pixel equality.
 */
function canvasShot(page: Page): Promise<Buffer> {
  return page.locator('#game').screenshot({
    // Only the canvas: hide the dev badges and the sign-in overlay drawn over it.
    style: '.dev-status, .auth-overlay, .auth-chip { visibility: hidden; }',
  });
}

/** A flat or blank canvas compresses to a few KB; the test scene to ~200 KB. */
const NOT_FLAT = 50_000;

function drag(from: Point, to: Point, steps: number): Record<number, Point>[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    1: { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps },
  }));
}

test('renders the Babylon scene and reaches the server', async ({ page }) => {
  test.setTimeout(90_000); // first load compiles shaders; CI renders in software
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');

  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  // WebGL2 is the Phase 1 default (tech spec §6).
  await expect(canvas).toHaveAttribute('data-renderer', 'webgl2');

  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);

  await expect(page.locator('[data-testid="dev-status"]')).toHaveText(/server: ok/);
  await expect(page.locator('[data-testid="dev-stats"]')).toHaveText(
    /^(\d+ fps|idle) · WebGL2 · high · \d\.\d\dx$/,
    { timeout: 15_000 },
  );
  expect(errors).toEqual([]);
});

test('WebGPU is opt-in and falls back to WebGL2 without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?renderer=webgpu&quality=low');
  // CI's WebKit has no WebGPU, so this lands on WebGL2 there; real devices may use WebGPU.
  await expect(page.locator('#game')).toHaveAttribute('data-renderer', /^(webgpu|webgl2)$/);
  await expect(page.locator('[data-testid="dev-stats"]')).toHaveText(/(WebGPU|WebGL2) · low/, {
    timeout: 15_000,
  });
  expect(errors).toEqual([]);
});

test('renders only when something changes', async ({ page }) => {
  test.setTimeout(90_000); // first load compiles shaders; CI renders in software
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Once loaded, a still map stops drawing, and the overlay says so.
  await waitForIdle(page);
  const still = await draws(page);
  await page.waitForTimeout(1000);
  expect(await draws(page)).toBe(still);
  await expect(page.locator('[data-testid="dev-stats"]')).toHaveText(/^idle · /);

  // The frame left on screen while idle must be a finished one, not a frame
  // drawn while shaders were still compiling (a blank or flat canvas).
  expect((await canvasShot(page)).length).toBeGreaterThan(NOT_FLAT);

  // An explicit invalidate draws, then the loop goes idle again.
  await invalidate(page);
  await expect.poll(() => draws(page)).toBeGreaterThan(still);
  await waitForIdle(page);

  // A pan draws frames, then the loop goes idle again.
  const vp = page.viewportSize()!;
  const mid = { x: vp.width / 2, y: vp.height / 2 };
  const to = { x: mid.x - 60, y: mid.y };
  const beforePan = await draws(page);
  await touch(page, [...drag(mid, to, 6), ...Array.from({ length: 8 }, () => ({ 1: to }))]);
  await expect.poll(() => draws(page), { timeout: 10_000 }).toBeGreaterThan(beforePan);
  await waitForIdle(page);
});

test('redraws after the WebGL context is lost and restored', async ({ page }) => {
  // iOS drops WebGL contexts under memory pressure and when the home-screen
  // app is backgrounded. Once the browser restores it, the scene must come
  // back, not stay a blank or half-restored canvas.
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForIdle(page);

  const rebuilt = await page.evaluateHandle(async () => {
    const old = document.querySelector<HTMLCanvasElement>('#game')!;
    const ext = old.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 500));
    ext.restoreContext();
    return old;
  });

  // The stage is rebuilt on a fresh canvas (boot.ts), which draws and settles.
  await expect
    .poll(
      () =>
        rebuilt.evaluate((old) => {
          const now = document.querySelector<HTMLCanvasElement>('#game');
          return now !== old && now?.dataset['ready'] === 'true';
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  // Settles back to idle on a finished (not blank) frame.
  await waitForIdle(page);
  expect((await canvasShot(page)).length).toBeGreaterThan(NOT_FLAT);
});

test('the camera pans, flings, pinch-zooms and stays in bounds', async ({ page }) => {
  test.setTimeout(180_000); // software rendering at iPad resolution is slow in CI
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const vp = page.viewportSize()!;
  const mid = { x: vp.width / 2, y: vp.height / 2 };
  // Gestures scale with the screen so iPhone and iPad move the map by similar amounts.
  const unit = Math.min(vp.width, vp.height) / 4;

  /** A drag that rests at the end before lifting, so it never flings. */
  const slowDrag = (to: Point) => [
    ...drag(mid, to, 8),
    ...Array.from({ length: 8 }, () => ({ 1: to })),
  ];

  // Slow drag left and up: the map follows the finger, so the view moves east and south.
  const start = await cameraState(page);
  await touch(page, slowDrag({ x: mid.x - unit, y: mid.y - unit }));
  const panned = await cameraState(page);
  expect(panned.target.x).toBeGreaterThan(start.target.x + 1);
  expect(panned.target.z).toBeLessThan(start.target.z - 1);
  expect(panned.flinging).toBe(false); // finger rested before lifting: no fling

  // Quick flick right: the map keeps gliding after release, then settles.
  await touch(page, drag(mid, { x: mid.x + unit, y: mid.y }, 4));
  const released = await cameraState(page);
  expect(released.flinging).toBe(true);
  await waitForFlingToSettle(page);
  const settled = await cameraState(page);
  expect(settled.target.x).toBeLessThan(released.target.x);

  // Pinch out zooms in; pinch in zooms out.
  const spread = (from: number, to: number) =>
    Array.from({ length: 9 }, (_, i) => {
      const half = from + ((to - from) * i) / 8;
      return { 1: { x: mid.x - half, y: mid.y }, 2: { x: mid.x + half, y: mid.y } };
    });
  await touch(page, spread(unit * 0.3, unit * 1.2));
  const zoomedIn = await cameraState(page);
  expect(zoomedIn.distance).toBeLessThan(settled.distance * 0.8);
  await touch(page, spread(unit * 1.2, unit * 0.3));
  expect((await cameraState(page)).distance).toBeGreaterThan(zoomedIn.distance);

  // One huge drag (the finger may leave the screen) pins the view at the east bound,
  // and dragging further doesn't move it.
  const farLeft = { x: mid.x - vp.width * 4, y: mid.y };
  await touch(page, slowDrag(farLeft));
  const edge = await cameraState(page);
  expect(edge.target.x).toBe(edge.bounds.maxX);
  await touch(page, slowDrag(farLeft));
  expect((await cameraState(page)).target.x).toBe(edge.bounds.maxX);

  // Synthetic events can't trigger native scroll or zoom, so check the guards
  // that stop them on a real device (and the page stayed put meanwhile).
  const guards = await page.evaluate(() => ({
    canvasTouchAction: getComputedStyle(document.querySelector('#game')!).touchAction,
    overflow: getComputedStyle(document.body).overflow,
    overscroll: getComputedStyle(document.body).overscrollBehaviorY,
    scroll: [window.scrollX, window.scrollY],
  }));
  expect(guards).toEqual({
    canvasTouchAction: 'none',
    overflow: 'hidden',
    overscroll: 'none',
    scroll: [0, 0],
  });
});

test('keeps its shape when the phone turns (#251)', async ({ page }) => {
  test.setTimeout(90_000); // first load compiles shaders; CI renders in software
  // iOS sends `resize` before the turned layout settles, and none after it.
  // Registered before the game's own listener, so it can swallow the real
  // one once asked to (listeners on the window run in the order added).
  await page.addInitScript(() => {
    window.addEventListener('resize', (e) => {
      if (e.isTrusted && document.documentElement.dataset['swallowResize']) {
        e.stopImmediatePropagation();
      }
    });
  });
  await page.goto('/');
  const canvas = page.locator('#game');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  await waitForIdle(page);
  const vp = page.viewportSize()!;

  // The page hears a resize while the canvas still has its old size (left
  // to settle, so its frames can't pick up the new size by chance), then
  // nothing when the layout turns.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    document.documentElement.dataset['swallowResize'] = 'true';
  });
  await waitForIdle(page);
  const before = await draws(page);
  await page.setViewportSize({ width: vp.height, height: vp.width });

  // The drawing buffer (which the camera's aspect is worked out from) takes
  // the canvas's new shape, and a frame is drawn at it.
  const shape = () =>
    canvas.evaluate((c: HTMLCanvasElement) => ({
      buffer: Math.round((c.width / c.height) * 100) / 100,
      box: Math.round((c.clientWidth / c.clientHeight) * 100) / 100,
    }));
  await expect
    .poll(async () => {
      const s = await shape();
      return s.buffer === s.box;
    })
    .toBe(true);
  expect((await shape()).box).toBeGreaterThan(1); // it did turn
  await expect.poll(() => draws(page)).toBeGreaterThan(before);
});
