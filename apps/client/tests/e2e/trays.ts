import { expect, type Locator, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';

// The map's controls live in two side trays (ui/trays). A spec that taps one
// opens its tray first, the way a player would.

export type TraySide = 'adventure' | 'heartpatch';

interface TraysState {
  visible: boolean;
  open: TraySide | null;
  hint: boolean;
  badges: Record<TraySide, string | null>;
}

/** Which tray each entry lives in. */
export const TRAY_OF: Readonly<Record<string, TraySide>> = {
  'battle-entry': 'adventure',
  'catalog-open': 'adventure',
  'battle-dev-grant': 'adventure',
  'battle-dev-fight': 'adventure',
  'raid-open': 'adventure',
  'hollow-open': 'adventure',
  'tray-claim': 'adventure',
  'home-open': 'heartpatch',
  'bag-open': 'heartpatch',
  'recipe-book-open': 'heartpatch',
  'hollow-fire-hint': 'heartpatch',
  'jobs-open': 'heartpatch',
  'team-open': 'heartpatch',
};

export const traysState = (page: Page): Promise<TraysState | null> =>
  hook<TraysState>(page, 'trays');

/** How a spec presses a handle: Playwright's instant tap, or a held press (touch.ts). */
export type TapHandle = (handle: Locator) => Promise<void>;
const instantTap: TapHandle = (handle) => handle.tap();

/** Opens one tray (shutting the other first). */
export async function openTray(
  page: Page,
  side: TraySide,
  tap: TapHandle = instantTap,
): Promise<void> {
  // Roomy: the map builds first, and CI renders in software.
  await expect.poll(async () => (await traysState(page))?.visible, { timeout: 30_000 }).toBe(true);
  const open = (await traysState(page))?.open ?? null;
  if (open === side) return;
  if (open !== null) {
    await tap(page.getByTestId(`tray-handle-${open}`));
    await expect.poll(async () => (await traysState(page))?.open, { timeout: 15_000 }).toBeNull();
  }
  await tap(page.getByTestId(`tray-handle-${side}`));
  await expect.poll(async () => (await traysState(page))?.open, { timeout: 15_000 }).toBe(side);
}

/** The button `testId` in its tray, with the tray open. */
export async function trayButton(
  page: Page,
  testId: string,
  tap: TapHandle = instantTap,
): Promise<Locator> {
  const side = TRAY_OF[testId];
  if (!side) throw new Error(`which tray holds ${testId}?`);
  await openTray(page, side, tap);
  return page.getByTestId(testId);
}
