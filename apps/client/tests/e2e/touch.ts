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

/** A real tap (down, hold, up) on the middle of `locator`, scrolled into view first. */
export async function realTap(locator: Locator, holdMs = REAL_TAP_HOLD_MS): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('realTap: the element has no box on screen');
  await realTapAt(locator.page(), box.x + box.width / 2, box.y + box.height / 2, holdMs);
}
