import type { Locator, Page } from '@playwright/test';

/*
 * Taps the way a finger does. Playwright's `tap()` puts the touch down and
 * lifts it in the same instant, so a control that is rebuilt or moved while a
 * finger rests on it (a render between pointerdown and pointerup, a layout
 * shift) still gets its click in a test and loses it on a phone: iOS decides
 * the tapped node when the finger lands and again when it lifts, and drops
 * the tap when the two differ. These helpers hold the press for a moment and
 * let the browser hit-test the lift on its own, so that class of bug shows up
 * in CI.
 */

/** How long a finger rests on a button in a normal tap, in ms. */
export const REAL_TAP_HOLD_MS = 120;

/**
 * Presses at a point on the page for `holdMs`, then lifts, with the browser
 * hit-testing both ends (no synthetic events). WebKit has no touch "hold" in
 * Playwright, so this presses with the primary pointer; the click still comes
 * from the lift's own hit test, as a tap's does.
 */
export async function realTapAt(
  page: Page,
  x: number,
  y: number,
  holdMs = REAL_TAP_HOLD_MS,
): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** How long a control must hold still before a finger lands on it, in ms. */
const AT_REST_MS = 80;
/** How long to wait for a control to stop moving (a tray slide is 280 ms). */
const AT_REST_TIMEOUT_MS = 5_000;

/**
 * Where `locator` sits once it has stopped moving: a tray still sliding in or
 * a chip still popping up would carry the control away between the press and
 * the lift, and a finger waits for that to end before it lands.
 */
export async function restingBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const page = locator.page();
  const started = Date.now();
  let last = await locator.boundingBox();
  for (;;) {
    await page.waitForTimeout(AT_REST_MS);
    const next = await locator.boundingBox();
    if (
      last &&
      next &&
      last.x === next.x &&
      last.y === next.y &&
      last.width === next.width &&
      last.height === next.height
    ) {
      return next;
    }
    if (Date.now() - started > AT_REST_TIMEOUT_MS) {
      throw new Error('realTap: the element kept moving');
    }
    last = next;
  }
}

/**
 * A real tap (down, hold, up) on the middle of `locator`, scrolled into view
 * first and left to come to rest.
 */
export async function realTap(locator: Locator, holdMs = REAL_TAP_HOLD_MS): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  const box = await restingBox(locator);
  await realTapAt(locator.page(), box.x + box.width / 2, box.y + box.height / 2, holdMs);
}

/**
 * A real tap whose press lasts until `changed` resolves (the game's own
 * signal that the control changed under the resting finger: a countdown
 * ticking), then lifts. The lift lands inside the control, with the part the
 * finger pressed still there, so sticky-taps leaves it to the browser: what's
 * checked is the browser's own click, which WebKit pairs with the very node
 * the pointer landed on (a label's Text node) and drops when that node is
 * gone by the lift.
 */
export async function realTapThrough(
  locator: Locator,
  changed: () => Promise<void>,
): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  const box = await restingBox(locator);
  const page = locator.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await changed();
  } finally {
    await page.mouse.up();
  }
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Plays touch pointer frames, 16 ms apart. Each frame lists every active
 * finger's position; fingers missing from the next frame lift. By default
 * every finger lands on the map's canvas, whatever is over it; with
 * `hitTest` each lands on the element under it, as a finger does, and keeps
 * sending there (a touch's implicit capture). Synthetic PointerEvents behave
 * the same in WebKit and Chromium. Frames are spaced with a busy-wait, not
 * timers: CI renders in software, where a 16 ms timer can take 300 ms and
 * every flick would look like a slow drag.
 */
export async function touch(
  page: Page,
  frames: Record<number, Point>[],
  { hitTest = false } = {},
): Promise<void> {
  await page.evaluate(
    ({ frames, hitTest }) => {
      const canvas = document.querySelector('#game')!;
      const landed = new Map<number, Element>();
      const fire = (type: string, id: number, p: Point) => {
        if (type === 'pointerdown') {
          landed.set(id, (hitTest && document.elementFromPoint(p.x, p.y)) || canvas);
        }
        landed.get(id)!.dispatchEvent(
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
    },
    { frames, hitTest },
  );
}
