import { expect, test, type Page } from '@playwright/test';

interface Point {
  x: number;
  y: number;
}

interface CameraState {
  target: { x: number; z: number };
  distance: number;
  flinging: boolean;
}

/** The dev-only hook from src/main.ts (typed in src/engine/devHook.d.ts, which this project can't see). */
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
  );
  expect(errors).toEqual([]);
});

test('falls back to WebGL2 when asked', async ({ page }) => {
  await page.goto('/?renderer=webgl2&quality=low');
  await expect(page.locator('#game')).toHaveAttribute('data-renderer', 'webgl2');
  await expect(page.locator('[data-testid="dev-stats"]')).toHaveText(/WebGL2 · low/);
});

test('the camera pans, flings, pinch-zooms and stays in bounds', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const vp = page.viewportSize()!;
  const mid = { x: vp.width / 2, y: vp.height / 2 };

  // Slow drag left and up: the map follows the finger, so the view moves east and south.
  const start = await cameraState(page);
  await touch(page, [
    ...drag(mid, { x: mid.x - 80, y: mid.y - 60 }, 8),
    { 1: { x: mid.x - 80, y: mid.y - 60 } },
    { 1: { x: mid.x - 80, y: mid.y - 60 } },
    { 1: { x: mid.x - 80, y: mid.y - 60 } },
    { 1: { x: mid.x - 80, y: mid.y - 60 } },
    { 1: { x: mid.x - 80, y: mid.y - 60 } },
    { 1: { x: mid.x - 80, y: mid.y - 60 } },
    { 1: { x: mid.x - 80, y: mid.y - 60 } },
  ]);
  const panned = await cameraState(page);
  expect(panned.target.x).toBeGreaterThan(start.target.x + 1);
  expect(panned.target.z).toBeLessThan(start.target.z - 1);
  expect(panned.flinging).toBe(false); // finger rested before lifting: no fling

  // Quick flick right: the map keeps gliding after release, then settles.
  await touch(page, drag(mid, { x: mid.x + 120, y: mid.y }, 4));
  const released = await cameraState(page);
  expect(released.flinging).toBe(true);
  await expect.poll(async () => (await cameraState(page)).flinging, { timeout: 5000 }).toBe(false);
  const settled = await cameraState(page);
  expect(settled.target.x).toBeLessThan(released.target.x);

  // Pinch out zooms in; pinch in zooms out.
  const before = settled.distance;
  await touch(
    page,
    Array.from({ length: 9 }, (_, i) => ({
      1: { x: mid.x - 30 - i * 10, y: mid.y },
      2: { x: mid.x + 30 + i * 10, y: mid.y },
    })),
  );
  const zoomedIn = await cameraState(page);
  expect(zoomedIn.distance).toBeLessThan(before * 0.8);
  await touch(
    page,
    Array.from({ length: 9 }, (_, i) => ({
      1: { x: mid.x - 110 + i * 10, y: mid.y },
      2: { x: mid.x + 110 - i * 10, y: mid.y },
    })),
  );
  expect((await cameraState(page)).distance).toBeGreaterThan(zoomedIn.distance);

  // Dragging far past the edge stops at the map bounds.
  for (let i = 0; i < 6; i++) {
    await touch(page, [
      ...drag(mid, { x: mid.x - 150, y: mid.y }, 4),
      { 1: { x: mid.x - 150, y: mid.y } },
    ]);
  }
  const edge = await cameraState(page);
  await touch(page, [
    ...drag(mid, { x: mid.x - 150, y: mid.y }, 4),
    { 1: { x: mid.x - 150, y: mid.y } },
  ]);
  expect((await cameraState(page)).target.x).toBeCloseTo(edge.target.x, 5);

  // The page itself never scrolls or zooms.
  expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
});
