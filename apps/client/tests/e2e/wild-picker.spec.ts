import { expect, test, type Page } from '@playwright/test';
import { tapCanvas } from './claim-land.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap } from './touch.js';
import { trayButton } from './trays.js';

// Picking which wild squishy to meet from the map (#209): tufts mark the
// tiles in reach with a wild squishy; tap one, then Meet it, and the battle
// opens on that tile. Checked through the dev hook, never pixels.

interface MapDebug {
  selected: string | null;
  wildMarkers: number;
  wild: { key: string; x: number; y: number }[];
}
interface BattleDebug {
  status: string;
  phase: string;
  pending: number;
  waiting: boolean;
}

const mapState = (page: Page) => hook<MapDebug>(page, 'map');
const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('tap a rustling tile, Meet it, and the battle opens there', async ({ browser }) => {
  test.setTimeout(300_000); // two map builds and an arena; CI renders in software
  const page = await newPlayer(browser, uniqueName('picker'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Rustle Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();

  // A third of tiles have someone each window, and a new patch has 19 in
  // reach, so there's (almost) always a tuft. The note under Find a squishy
  // counts them.
  await expect
    .poll(async () => (await mapState(page))?.wildMarkers ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const count = (await mapState(page))!.wildMarkers;
  await trayButton(page, 'battle-entry');
  await expect(page.locator('.battle-entry-note')).toHaveText(
    `${String(count)} nearby! Or tap a rustle to pick.`,
  );
  await page.locator('[data-testid="tray-adventure"] .tray-close').tap();

  // The farthest tuft (the last hint), so Find a squishy would pick another.
  const panel = page.getByTestId('tile-panel');
  const markers = (await mapState(page))!.wild;
  expect(markers.length).toBeGreaterThan(0);
  const target = markers.at(-1)!;
  // Right after the map builds a tap can miss while the camera settles: tap
  // again only while that tile isn't picked.
  await expect(async () => {
    if ((await mapState(page))?.selected !== target.key) {
      const now = (await mapState(page))!.wild.find((m) => m.key === target.key)!;
      await tapCanvas(page, now.x, now.y);
    }
    await expect(panel.getByTestId('tile-wild-rustle')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  expect((await mapState(page))?.selected).toBe(target.key);
  await expect(panel.getByTestId('tile-wild-rustle')).toHaveText("Something's rustling here!");

  const meet = panel.getByTestId('tile-meet-wild');
  await expect(meet).toHaveText('Meet it');
  await meet.tap();

  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('map-hud')).toBeHidden();
  await expect
    .poll(() => battleState(page), { timeout: 30_000 })
    .toMatchObject({ status: 'active', phase: 'turn', pending: 0, waiting: false });

  // Run home: that squishy wanders off (#208), so its tuft goes and the rest stay.
  await realTap(page.getByTestId('battle-run'));
  await realTap(page.getByTestId('battle-run-confirm'));
  await expect(page.getByTestId('battle-result')).toBeVisible({ timeout: 30_000 });
  await realTap(page.getByTestId('battle-done'));
  await expect(page.getByTestId('map-hud')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await mapState(page))?.wildMarkers, { timeout: 30_000 })
    .toBe(count - 1);
  const left = (await mapState(page))!.wild.map((m) => m.key);
  expect(left).not.toContain(target.key);
  expect(errors).toEqual([]);
});
