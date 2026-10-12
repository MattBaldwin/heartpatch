import { expect, type Locator, type Page } from '@playwright/test';

// The Squishies roster (#375): the 🐾 button in the top bar (map, home or
// explore) opens one list of my squishies, and a row's Care opens its care
// sheet. Specs that care for a squishy go through here (two taps).

const slow = { timeout: 30_000 };

/** Opens the roster from whichever 🐾 is on screen; resolves once rows show. */
export async function openRoster(page: Page): Promise<Locator> {
  const roster = page.getByTestId('roster');
  // Right after a view change the last view's 🐾 may still be fading out:
  // tap whichever one is on screen until the roster opens.
  await expect(async () => {
    if (!(await roster.isVisible())) {
      await page.locator('[data-testid="squishies-open"]:visible').first().tap({ timeout: 3_000 });
    }
    await expect(roster).toBeVisible({ timeout: 3_000 });
  }).toPass(slow);
  await expect(page.getByTestId('roster-row').first()).toBeVisible(slow);
  return roster;
}

/** The care sheet of the roster's `index`th squishy (in the roster's order), open. */
export async function careFromRoster(page: Page, index = 0): Promise<Locator> {
  await openRoster(page);
  await page.getByTestId('roster-care').nth(index).tap();
  const care = page.getByTestId('care');
  await expect(care).toBeVisible(slow);
  return care;
}

/** Closes the roster if it's open. */
export async function closeRoster(page: Page): Promise<void> {
  const roster = page.getByTestId('roster');
  if (await roster.isVisible()) {
    await roster.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(roster).toBeHidden();
  }
}
