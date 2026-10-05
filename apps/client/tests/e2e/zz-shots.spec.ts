import { expect, test } from '@playwright/test';
import { newPlayer, uniqueName, visitPatch } from './players.js';

const OUT = '/tmp/claude-0/-home-user-heartpatch/b90fdad8-450d-5eae-9340-4c59b4af0c04/scratchpad/shots';

test('shots', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('shot'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Maple Hollow');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/1-closed-hint.png` });
  await page.getByTestId('tray-hint-ok').tap();
  await page.getByTestId('tray-handle-heartpatch').tap();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/2-right.png` });
  await page.getByTestId('tray-handle-heartpatch').tap();
  await page.getByTestId('tray-handle-adventure').tap();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/3-left.png` });
  await page.getByTestId('tray-handle-adventure').tap();
  await page.waitForTimeout(400);
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.width / 2, box.height / 2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/4-tile.png` });
  await page.getByTestId('tile-panel').getByRole('button', { name: 'Close' }).tap();
  await page.getByTestId('keeper-menu').tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/5-menu.png` });
});
