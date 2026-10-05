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
const TRAY_OF: Readonly<Record<string, TraySide>> = {
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
};

export const traysState = (page: Page): Promise<TraysState | null> =>
  hook<TraysState>(page, 'trays');

/** Opens one tray (shutting the other first). */
export async function openTray(page: Page, side: TraySide): Promise<void> {
  await expect.poll(async () => (await traysState(page))?.visible).toBe(true);
  const open = (await traysState(page))?.open ?? null;
  if (open === side) return;
  if (open !== null) await page.getByTestId(`tray-handle-${open}`).tap();
  await page.getByTestId(`tray-handle-${side}`).tap();
  await expect.poll(async () => (await traysState(page))?.open).toBe(side);
}

/** The button `testId` in its tray, with the tray open. */
export async function trayButton(page: Page, testId: string): Promise<Locator> {
  const side = TRAY_OF[testId];
  if (!side) throw new Error(`which tray holds ${testId}?`);
  await openTray(page, side);
  return page.getByTestId(testId);
}
