import { expect, test, type Page } from '@playwright/test';

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

/** The dev-only hook from src/main.ts (typed in src/engine/dev-hook.d.ts, which this project can't see). */
interface DevHook {
  camera(): CameraState | null;
}

function cameraState(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __heartpatch?: DevHook }).__heartpatch;
    const state = hook?.camera();
    if (!state) throw new Error('camera not ready');
    return state;
  });
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

function drag(from: Point, to: Point, steps: number): Record<number, Point>[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    1: { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps },
  }));
}

test('renders the Babylon scene and reaches the server', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');

  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  // CI's WebKit has no WebGPU, so it exercises the WebGL2 path (tech spec §6).
  await expect(canvas).toHaveAttribute('data-renderer', /^(webgpu|webgl2)$/);

  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);

  await expect(page.locator('[data-testid="dev-status"]')).toHaveText(/server: ok/);
  await expect(page.locator('[data-testid="dev-stats"]')).toHaveText(
    /^\d+ fps · (WebGPU|WebGL2) · high · \d\.\d\dx$/,
    { timeout: 15_000 },
  );
  expect(errors).toEqual([]);
});

test('falls back to WebGL2 when asked', async ({ page }) => {
  await page.goto('/?renderer=webgl2&quality=low');
  await expect(page.locator('#game')).toHaveAttribute('data-renderer', 'webgl2');
  await expect(page.locator('[data-testid="dev-stats"]')).toHaveText(/WebGL2 · low/);
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
  // Generous: the glide integrates at most 100 ms per frame, and CI renders in software.
  await expect
    .poll(async () => (await cameraState(page)).flinging, { timeout: 20_000 })
    .toBe(false);
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
