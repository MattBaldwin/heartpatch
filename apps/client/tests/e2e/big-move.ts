import type { Locator, Page } from '@playwright/test';

/**
 * A move button that can tucker out a wild squishy or a neutral guardian: a
 * 💥 Big one (#587), since steady moves are gentle with them. The first move
 * when none is big (a squishy with no attacks).
 */
export async function bigMoveButton(page: Page): Promise<Locator> {
  const big = page.locator('[data-testid="battle-move"][data-style="big"]');
  return (await big.count()) > 0 ? big.first() : page.getByTestId('battle-move').first();
}
