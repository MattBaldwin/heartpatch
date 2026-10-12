import type { Locator, Page } from '@playwright/test';
import { hook } from './dev-hook.js';

// Home opens with its sheet as a short peek bar (#412). The squishy list is
// in the full sheet, one tap on "🐾 Squishies" away.

/** The home sheet's squishy list, opening the sheet to it first if it's folded. */
export async function homeFriends(page: Page): Promise<Locator> {
  const state = await hook<{ sheet: 'peek' | 'open' }>(page, 'home');
  if (state?.sheet !== 'open') await page.getByTestId('home-squishies').tap();
  return page.getByTestId('home-friends');
}
