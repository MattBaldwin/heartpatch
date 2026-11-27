import { expect, type Page } from '@playwright/test';
import { hook, liveMapId } from './dev-hook.js';

type Hooks = { __heartpatch?: { farHollowDev?: () => { openSheet(): void } } };

/**
 * Opens the far Hollow's sheet through the dev hook and waits until it shows
 * "Go inside" (#784). The sheet reads the open map's id when it opens
 * (far-hollow-sheet.ts `load`) and quietly does nothing without one, and the
 * map is still loading for a moment after `#game[data-ready]`. On a slow
 * software-rendered iPad that moment was long enough that the sheet never
 * opened, and the "Go inside" tap waited for a button that never came until
 * the test timed out (`far-hollow-house.spec.ts:55` and `:260`, four main runs).
 */
export async function openFarHollowSheet(page: Page): Promise<void> {
  await liveMapId(page);
  await page.evaluate(() =>
    (window as unknown as Hooks).__heartpatch?.farHollowDev?.().openSheet(),
  );
  await expect
    .poll(() => hook<{ open: boolean; state: string | null }>(page, 'farHollow'), {
      timeout: 30_000,
    })
    .toEqual({ open: true, state: 'arrived' });
}
