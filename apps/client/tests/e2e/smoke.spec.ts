import { expect, test } from '@playwright/test';

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

  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);

  await expect(page.locator('[data-testid="dev-status"]')).toHaveText(/server: ok/);
  expect(errors).toEqual([]);
});
