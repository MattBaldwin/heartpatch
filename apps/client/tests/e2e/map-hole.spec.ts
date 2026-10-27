import { expect, test, type Page } from '@playwright/test';
import { claimLand, tapTile } from './claim-land.js';
import { hook, idle, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { traysState } from './trays.js';

/**
 * Issue #389: after claiming land, your tile's panel lists enough to scroll,
 * and a scrolling panel with a solid background made Chromium skip drawing
 * the map canvas under a rectangle near the top of the screen, so the page's
 * pink showed through. The WebGL frame itself was fine, so this is checked
 * by pixels: a screenshot of what the player sees.
 */

const mapState = (page: Page) => hook<{ id: string; selected: string | null }>(page, 'map');

/** The page background (styles.css `#fde8f0`), which shows through a hole in the canvas. */
const PAGE_PINK = [253, 232, 240] as const;

/**
 * The share of the canvas's screenshot (what the player sees) in the page
 * pink, and the tallest run of page-pink rows. Decoded in the page itself, so
 * no PNG library is needed.
 */
async function pagePinkInCanvas(page: Page): Promise<{ share: number; rows: number }> {
  const png = await page.locator('#game').screenshot({ animations: 'disabled' });
  return page.evaluate(
    async ({ base64, pink }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const g = canvas.getContext('2d')!;
      g.drawImage(image, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, image.width, image.height);
      let matches = 0;
      let run = 0;
      let rows = 0;
      for (let y = 0; y < height; y++) {
        let rowMatches = 0;
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const near =
            Math.abs(data[i]! - pink[0]) <= 2 &&
            Math.abs(data[i + 1]! - pink[1]) <= 2 &&
            Math.abs(data[i + 2]! - pink[2]) <= 2;
          if (near) rowMatches++;
        }
        matches += rowMatches;
        // A row that's mostly page pink is part of a hole; the map has none.
        run = rowMatches > width / 2 ? run + 1 : 0;
        rows = Math.max(rows, run);
      }
      return { share: matches / (width * height), rows };
    },
    { base64: png.toString('base64'), pink: PAGE_PINK },
  );
}

test('claimed land leaves no hole in the map', async ({ browser }) => {
  test.setTimeout(240_000); // map and arena builds and a claim; CI renders in software
  const page = await newPlayer(browser, uniqueName('hole'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Holey Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await waitForLiveMap(page);
  const mapId = (await mapState(page))!.id;

  const claimed = await claimLand(page, mapId);
  // No trays open, and the claimed tile's panel over the map, as in the issue.
  await expect.poll(async () => (await traysState(page))?.open ?? null).toBeNull();
  await tapTile(page, claimed);
  const panel = page.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  // The hole needs a panel that scrolls. On a phone, your land's panel always
  // does; on wider screens (map.css, 662px) it's taller and may not.
  if (page.viewportSize()!.width < 662) {
    expect(await panel.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  }

  // Once the map has settled, look: it has no big flat page-pink patch.
  await expect.poll(() => idle(page), { timeout: 60_000 }).toBe(true);
  const pink = await pagePinkInCanvas(page);
  await page.screenshot({ path: test.info().outputPath('map-after-claim.png') });
  expect(pink.rows, `page-pink rows: ${JSON.stringify(pink)}`).toBeLessThan(40);
  expect(pink.share).toBeLessThan(0.05);
});
